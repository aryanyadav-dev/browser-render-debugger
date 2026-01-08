/**
 * WebKit Native Adapter
 *
 * Browser adapter for WebKit-based browsers (Safari, iOS WebView) using
 * file-based trace ingestion from the Swift instrumentation SDK.
 *
 * Unlike the CDP adapter, this adapter:
 * - Does NOT connect to a browser via websocket
 * - Ingests sanitized JSON traces from a file/directory
 * - Has limited capabilities (no GPU events, limited DOM signals)
 * - Is designed for production use with sampling controls
 *
 * Requirements: 15.8, 15.9
 */

import { Logger } from '@nestjs/common';
import { readFile, access, constants } from 'fs/promises';
import { join } from 'path';
import {
  BaseBrowserAdapter,
  AdapterCapability,
  AdapterMetadata,
  AdapterConnectionOptions,
  TraceCollectionOptions,
} from '../interfaces/index.js';
import {
  TraceSnapshot,
  FrameTiming,
  LongTaskInfo,
  DOMSignal,
  calculateFrameMetrics,
  generateTraceId,
} from '../models/index.js';
import {
  NativeTraceFormat,
  NativeFrameTiming,
  NativeLongTask,
  NativeDOMSignal,
  validateNativeTrace,
  parseNativeTrace,
} from './schemas/index.js';

/**
 * WebKit-specific connection options
 */
export interface WebKitNativeConnectionOptions extends AdapterConnectionOptions {
  /** Directory containing trace files from Swift SDK */
  traceDir?: string;
  /** Specific trace file to ingest */
  traceFile?: string;
}

/**
 * WebKit Native Adapter
 *
 * Ingests sanitized JSON traces from the Swift instrumentation SDK.
 * No CDP dependency - purely file-based trace ingestion.
 */
export class WebKitNativeAdapter extends BaseBrowserAdapter {
  readonly metadata: AdapterMetadata = {
    type: 'webkit-native',
    name: 'WebKit Native Adapter',
    description:
      'File-based trace ingestion for WebKit browsers (Safari, iOS WebView) via Swift SDK',
    capabilities: [
      AdapterCapability.FRAME_TIMING,
      AdapterCapability.LONG_TASKS,
      AdapterCapability.DOM_SIGNALS, // Limited compared to CDP
    ],
    browserPatterns: [/safari/i, /webkit/i, /ios/i, /iphone/i, /ipad/i],
    priority: 50, // Lower priority than CDP adapters
  };

  private readonly logger = new Logger(WebKitNativeAdapter.name);
  private traceDir: string | null = null;
  private traceFile: string | null = null;
  private loadedTrace: NativeTraceFormat | null = null;

  /**
   * Connect to the trace source (directory or file)
   *
   * For WebKit native adapter, "connecting" means validating
   * that the trace directory/file exists and is accessible.
   */
  async connect(options: AdapterConnectionOptions): Promise<void> {
    const webkitOptions = options as WebKitNativeConnectionOptions;

    this.logger.log('Initializing WebKit Native Adapter');

    // Validate trace source
    if (webkitOptions.traceFile) {
      await this.validateTraceFile(webkitOptions.traceFile);
      this.traceFile = webkitOptions.traceFile;
      this.traceDir = null;
    } else if (webkitOptions.traceDir) {
      await this.validateTraceDir(webkitOptions.traceDir);
      this.traceDir = webkitOptions.traceDir;
      this.traceFile = null;
    } else {
      // Default to current directory's .render-debugger/traces
      const defaultDir = join(process.cwd(), '.render-debugger', 'traces');
      try {
        await this.validateTraceDir(defaultDir);
        this.traceDir = defaultDir;
      } catch {
        // Directory doesn't exist, that's okay - we'll create it or use explicit path
        this.traceDir = defaultDir;
        this.logger.warn(
          `Default trace directory does not exist: ${defaultDir}`,
        );
      }
    }

    // Mark as connected
    this.setConnected(true, 'WebKit Native (file-based)');
    this.setError(undefined);

    this.logger.log(
      `WebKit Native Adapter initialized. Trace source: ${this.traceFile ?? this.traceDir}`,
    );
  }

  /**
   * Disconnect from the trace source
   */
  disconnect(): Promise<void> {
    this.traceDir = null;
    this.traceFile = null;
    this.loadedTrace = null;
    this.setConnected(false);
    this.logger.log('WebKit Native Adapter disconnected');
    return Promise.resolve();
  }

  /**
   * Collect a trace snapshot by reading from file
   *
   * Unlike CDP adapter which actively collects traces, this adapter
   * reads pre-collected traces from the Swift SDK output.
   */
  async collectTrace(options: TraceCollectionOptions): Promise<TraceSnapshot> {
    if (!this._connected) {
      throw new Error('Adapter not connected. Call connect() first.');
    }

    this.setCollecting(true);

    try {
      // Determine which trace file to read
      const traceFilePath = await this.resolveTraceFile(options);

      // Read and parse the trace file
      const nativeTrace = await this.readTraceFile(traceFilePath);
      this.loadedTrace = nativeTrace;

      // Normalize to TraceSnapshot
      const snapshot = this.normalizeToTraceSnapshot(nativeTrace, options);

      this.logger.log(
        `Collected trace: ${snapshot.name} (${snapshot.frameTimings.length} frames, ${snapshot.longTasks.length} long tasks)`,
      );

      return snapshot;
    } finally {
      this.setCollecting(false);
    }
  }

  /**
   * Get the last loaded native trace (for debugging)
   */
  getLoadedTrace(): NativeTraceFormat | null {
    return this.loadedTrace;
  }

  /**
   * Validate that a trace file exists and is readable
   */
  private async validateTraceFile(filePath: string): Promise<void> {
    try {
      await access(filePath, constants.R_OK);
    } catch {
      throw new Error(`Trace file not accessible: ${filePath}`);
    }
  }

  /**
   * Validate that a trace directory exists
   */
  private async validateTraceDir(dirPath: string): Promise<void> {
    try {
      await access(dirPath, constants.R_OK);
    } catch {
      throw new Error(`Trace directory not accessible: ${dirPath}`);
    }
  }

  /**
   * Resolve which trace file to read based on options
   */
  private async resolveTraceFile(
    options: TraceCollectionOptions,
  ): Promise<string> {
    // If a specific trace file was provided at connection time, use it
    if (this.traceFile) {
      return this.traceFile;
    }

    // If URL is provided, it might be a file path to a trace
    if (options.url && options.url.endsWith('.json')) {
      return options.url;
    }

    // If scenario is provided, look for a trace file with that name
    if (options.scenario && this.traceDir) {
      const scenarioFile = join(this.traceDir, `${options.scenario}.json`);
      try {
        await this.validateTraceFile(scenarioFile);
        return scenarioFile;
      } catch {
        // Fall through to look for latest trace
      }
    }

    // Look for the most recent trace file in the trace directory
    if (this.traceDir) {
      const latestTrace = await this.findLatestTraceFile(this.traceDir);
      if (latestTrace) {
        return latestTrace;
      }
    }

    throw new Error(
      'No trace file found. Provide --trace-file, --scenario, or ensure traces exist in the trace directory.',
    );
  }

  /**
   * Find the most recent trace file in a directory
   */
  private async findLatestTraceFile(dirPath: string): Promise<string | null> {
    const { readdir, stat } = await import('fs/promises');

    try {
      const files = await readdir(dirPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        return null;
      }

      // Get file stats and sort by modification time
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = join(dirPath, file);
          const stats = await stat(filePath);
          return { path: filePath, mtime: stats.mtime };
        }),
      );

      fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      return fileStats[0]?.path ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Read and parse a trace file
   */
  private async readTraceFile(filePath: string): Promise<NativeTraceFormat> {
    this.logger.debug(`Reading trace file: ${filePath}`);

    const content = await readFile(filePath, 'utf-8');
    const trace = parseNativeTrace(content);

    // Log validation warnings
    const validation = validateNativeTrace(trace);
    if (validation.warnings.length > 0) {
      for (const warning of validation.warnings) {
        this.logger.warn(`Trace validation warning: ${warning}`);
      }
    }

    return trace;
  }

  /**
   * Normalize native trace format to TraceSnapshot model
   */
  private normalizeToTraceSnapshot(
    nativeTrace: NativeTraceFormat,
    options: TraceCollectionOptions,
  ): TraceSnapshot {
    const fpsTarget = options.fpsTarget ?? nativeTrace.metadata.fpsTarget ?? 60;

    // Convert frame timings
    const frameTimings = this.convertFrameTimings(
      nativeTrace.frames,
      fpsTarget,
    );

    // Convert long tasks
    const longTasks = this.convertLongTasks(nativeTrace.longTasks ?? []);

    // Convert DOM signals
    const domSignals = this.convertDOMSignals(nativeTrace.domSignals ?? []);

    // Calculate frame metrics
    const frameMetrics = calculateFrameMetrics(frameTimings, fpsTarget);

    // Build snapshot
    const snapshot: TraceSnapshot = {
      id: options.id ?? nativeTrace.traceId ?? generateTraceId(),
      name: options.name ?? nativeTrace.name,
      durationMs: nativeTrace.durationMs,
      frameTimings,
      frameMetrics,
      longTasks,
      domSignals,
      gpuEvents: [], // Not available from native traces
      paintEvents: [], // Not available from native traces
      metadata: {
        browserVersion: this.buildBrowserVersion(nativeTrace.metadata),
        userAgent: this.buildUserAgent(nativeTrace.metadata),
        viewport: nativeTrace.metadata.screenSize,
        devicePixelRatio: nativeTrace.metadata.scale,
        timestamp: nativeTrace.metadata.timestamp,
        fpsTarget,
        url: options.url ?? nativeTrace.metadata.url,
        scenario: options.scenario ?? nativeTrace.metadata.scenario,
        adapterType: 'webkit-native',
        platform: 'webkit',
      },
    };

    return snapshot;
  }

  /**
   * Convert native frame timings to TraceSnapshot format
   */
  private convertFrameTimings(
    nativeFrames: NativeFrameTiming[],
    fpsTarget: number,
  ): FrameTiming[] {
    const frameBudgetMs = 1000 / fpsTarget;

    return nativeFrames.map((frame) => ({
      frameId: frame.frameId,
      startTime: frame.startTimestamp,
      endTime: frame.endTimestamp,
      durationMs: frame.durationMs,
      dropped: frame.dropped || frame.durationMs > frameBudgetMs,
      // Native traces don't have phase breakdown
      styleRecalcMs: undefined,
      layoutMs: undefined,
      paintMs: undefined,
      compositeMs: undefined,
      gpuMs: undefined,
    }));
  }

  /**
   * Convert native long tasks to TraceSnapshot format
   */
  private convertLongTasks(nativeTasks: NativeLongTask[]): LongTaskInfo[] {
    return nativeTasks.map((task) => ({
      startTime: task.startTimestamp,
      durationMs: task.durationMs,
      functionName: task.functionName ?? task.name ?? '<unknown>',
      file: task.file,
      line: task.line,
      column: task.column,
      callStack: [], // Native traces typically don't have full call stacks
    }));
  }

  /**
   * Convert native DOM signals to TraceSnapshot format
   */
  private convertDOMSignals(nativeSignals: NativeDOMSignal[]): DOMSignal[] {
    return nativeSignals.map((signal) => ({
      type: this.mapDOMSignalType(signal.type),
      timestamp: signal.timestamp,
      durationMs: signal.durationMs,
      selector: signal.selector,
      affectedNodes: signal.affectedNodes,
    }));
  }

  /**
   * Map native DOM signal type to TraceSnapshot type
   */
  private mapDOMSignalType(
    nativeType: 'layout' | 'style_recalc' | 'dom_mutation',
  ): DOMSignal['type'] {
    switch (nativeType) {
      case 'layout':
        return 'forced_reflow';
      case 'style_recalc':
        return 'style_recalc';
      case 'dom_mutation':
        return 'dom_mutation';
      default:
        return 'forced_reflow';
    }
  }

  /**
   * Build browser version string from metadata
   */
  private buildBrowserVersion(metadata: NativeTraceFormat['metadata']): string {
    const parts: string[] = [];

    if (metadata.osVersion) {
      parts.push(metadata.osVersion);
    }
    if (metadata.deviceModel) {
      parts.push(metadata.deviceModel);
    }
    if (metadata.appVersion) {
      parts.push(`App/${metadata.appVersion}`);
    }

    return parts.length > 0 ? parts.join(' ') : 'WebKit Native';
  }

  /**
   * Build user agent string from metadata
   */
  private buildUserAgent(metadata: NativeTraceFormat['metadata']): string {
    const parts: string[] = ['WebKit'];

    if (metadata.osVersion) {
      parts.push(`(${metadata.osVersion})`);
    }
    if (metadata.bundleId) {
      parts.push(metadata.bundleId);
    }

    return parts.join(' ');
  }
}

/**
 * Factory function for creating WebKitNativeAdapter instances
 */
export function createWebKitNativeAdapter(): WebKitNativeAdapter {
  return new WebKitNativeAdapter();
}
