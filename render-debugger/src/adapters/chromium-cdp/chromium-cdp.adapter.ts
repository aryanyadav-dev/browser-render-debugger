/**
 * Chromium CDP Adapter
 *
 * Browser adapter for Chromium-based browsers using Chrome DevTools Protocol.
 * Provides full access to the rendering pipeline: style, layout, paint, composite, GPU, JS.
 *
 * Supports:
 * - Chrome, Chromium, Edge, Brave
 * - Arc, Dia, Zen (staging/dev builds with CDP enabled)
 * - Any Chromium-based browser with remote-debugging-port enabled
 *
 * Requirements: 15.5, 15.6
 */

import { Logger } from '@nestjs/common';
import CDP from 'chrome-remote-interface';
import { spawn, ChildProcess } from 'child_process';
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
  GPUEvent,
  PaintEvent,
  StackFrameInfo,
  calculateFrameMetrics,
  generateTraceId,
} from '../models/index.js';
import type { TraceEvent } from '../../shared/types/index.js';

/**
 * CDP-specific connection options
 */
export interface ChromiumCDPConnectionOptions extends AdapterConnectionOptions {
  /** CDP port (default: 9222) */
  port?: number;
  /** CDP host (default: localhost) */
  host?: string;
  /** WebSocket endpoint for direct connection */
  wsEndpoint?: string;
}

/**
 * CDP Client interface
 */
interface CDPClient {
  send(method: string, params?: object): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
  close(): Promise<void>;
  Browser: {
    getVersion(): Promise<{
      protocolVersion: string;
      product: string;
      revision: string;
      userAgent: string;
      jsVersion: string;
    }>;
  };
  Page: {
    enable(): Promise<void>;
    navigate(params: {
      url: string;
    }): Promise<{ frameId: string; loaderId?: string }>;
    loadEventFired(): Promise<void>;
  };
  Runtime: {
    enable(): Promise<void>;
    evaluate(params: {
      expression: string;
      awaitPromise?: boolean;
    }): Promise<unknown>;
  };
}

/**
 * Default trace categories for comprehensive rendering analysis
 */
const DEFAULT_TRACE_CATEGORIES = [
  'devtools.timeline',
  'blink.user_timing',
  'gpu',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
];

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_CDP_HOST = 'localhost';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Chromium CDP Adapter
 *
 * Connects to Chromium-based browsers via CDP websocket and collects
 * comprehensive trace data from the rendering pipeline.
 */
export class ChromiumCDPAdapter extends BaseBrowserAdapter {
  readonly metadata: AdapterMetadata = {
    type: 'chromium-cdp',
    name: 'Chromium CDP Adapter',
    description:
      'Full CDP access for Chromium-based browsers (Chrome, Edge, Brave, Arc, Dia, Zen)',
    capabilities: [
      AdapterCapability.FULL_CDP,
      AdapterCapability.FRAME_TIMING,
      AdapterCapability.LONG_TASKS,
      AdapterCapability.DOM_SIGNALS,
      AdapterCapability.GPU_EVENTS,
      AdapterCapability.PAINT_EVENTS,
      AdapterCapability.SOURCE_MAPS,
      AdapterCapability.LIVE_MONITORING,
    ],
    browserPatterns: [
      /chrome/i,
      /chromium/i,
      /edge/i,
      /brave/i,
      /arc/i,
      /dia/i,
      /zen/i,
      /opera/i,
      /vivaldi/i,
    ],
    priority: 100, // Highest priority for Chromium browsers
  };

  private readonly logger = new Logger(ChromiumCDPAdapter.name);
  private client: CDPClient | null = null;
  private browserProcess: ChildProcess | null = null;
  private traceEvents: TraceEvent[] = [];
  private isTracing = false;

  /**
   * Connect to a Chromium browser via CDP
   */
  async connect(options: AdapterConnectionOptions): Promise<void> {
    const cdpOptions = options as ChromiumCDPConnectionOptions;

    const port = cdpOptions.port ?? DEFAULT_CDP_PORT;
    const host = cdpOptions.host ?? DEFAULT_CDP_HOST;

    this.logger.log(`Connecting to CDP at ${host}:${port}`);

    // If browser path is provided, launch the browser
    if (cdpOptions.browserPath) {
      await this.launchBrowser(
        cdpOptions.browserPath,
        port,
        cdpOptions.headless ?? true,
      );
    }

    // Connect to CDP with retry logic
    this.client = await this.connectWithRetry(
      host,
      port,
      cdpOptions.wsEndpoint,
    );

    // Get browser version
    const version = await this.client.Browser.getVersion();
    this.setConnected(true, version.product);
    this.setError(undefined);

    this.logger.log(`Connected to ${version.product}`);
  }

  /**
   * Disconnect from the browser
   */
  async disconnect(): Promise<void> {
    if (this.isTracing) {
      try {
        await this.stopTracing();
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
    }

    if (this.browserProcess) {
      this.browserProcess.kill('SIGTERM');
      this.browserProcess = null;
    }

    this.setConnected(false);
    this.logger.log('Disconnected from CDP');
  }

  /**
   * Collect a trace snapshot
   */
  async collectTrace(options: TraceCollectionOptions): Promise<TraceSnapshot> {
    if (!this.client) {
      throw new Error('Not connected to browser');
    }

    this.setCollecting(true);

    try {
      // Navigate to URL if provided
      if (options.url) {
        await this.navigateTo(options.url);
      }

      // Start tracing
      const categories = options.traceCategories ?? DEFAULT_TRACE_CATEGORIES;
      await this.startTracing(categories);

      // Wait for specified duration
      const durationMs = options.durationMs ?? 15000;
      await this.delay(durationMs);

      // Stop tracing and get events
      const traceEvents = await this.stopTracing();

      // Normalize to TraceSnapshot
      const snapshot = this.normalizeToTraceSnapshot(traceEvents, options);

      return snapshot;
    } finally {
      this.setCollecting(false);
    }
  }

  /**
   * Navigate to a URL
   */
  async navigateTo(url: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to browser');
    }

    await this.client.Page.enable();
    await this.client.Page.navigate({ url });

    // Wait for page load
    await this.client.Page.loadEventFired();
    this.logger.debug(`Navigated to ${url}`);
  }

  /**
   * Launch browser with remote debugging enabled
   */
  private async launchBrowser(
    browserPath: string,
    port: number,
    headless: boolean,
  ): Promise<void> {
    const args = [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
    ];

    if (headless) {
      args.push('--headless=new');
    }

    this.logger.debug(`Launching browser: ${browserPath}`);
    this.browserProcess = spawn(browserPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Wait for browser to be ready
    await this.waitForBrowserReady(port);
  }

  /**
   * Wait for browser to accept CDP connections
   */
  private async waitForBrowserReady(port: number): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const targets = await CDP.List({ port });
        if (targets && targets.length > 0) {
          return;
        }
      } catch {
        // Browser not ready yet
      }
      await this.delay(delayMs);
    }

    throw new Error('Browser did not become ready in time');
  }

  /**
   * Connect to CDP with retry logic
   */
  private async connectWithRetry(
    host: string,
    port: number,
    wsEndpoint?: string,
  ): Promise<CDPClient> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const options: { host?: string; port?: number; target?: string } = {};

        if (wsEndpoint) {
          options.target = wsEndpoint;
        } else {
          options.host = host;
          options.port = port;
        }

        const client = await CDP(options);
        return client as unknown as CDPClient;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `CDP connection attempt ${attempt} failed: ${lastError.message}`,
        );

        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    this.setError(lastError?.message);
    throw new Error(
      `Failed to connect to CDP at ${host}:${port}: ${lastError?.message}`,
    );
  }

  /**
   * Start CDP tracing
   */
  private async startTracing(categories: string[]): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected to browser');
    }

    if (this.isTracing) {
      throw new Error('Tracing is already in progress');
    }

    this.traceEvents = [];
    this.isTracing = true;

    // Set up trace data handler
    this.client.on('Tracing.dataCollected', (params: unknown) => {
      const data = params as { value: TraceEvent[] };
      if (data.value && Array.isArray(data.value)) {
        this.traceEvents.push(...data.value);
      }
    });

    // Start tracing
    await this.client.send('Tracing.start', {
      categories: categories.join(','),
      options: 'sampling-frequency=10000',
      bufferUsageReportingInterval: 500,
      transferMode: 'ReportEvents',
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: categories,
      },
    });

    this.logger.debug('Tracing started');
  }

  /**
   * Stop CDP tracing and return collected events
   */
  private async stopTracing(): Promise<TraceEvent[]> {
    if (!this.client || !this.isTracing) {
      return [];
    }

    // Create promise for tracing completion
    const completePromise = new Promise<void>((resolve) => {
      this.client!.on('Tracing.tracingComplete', () => {
        resolve();
      });
    });

    // End tracing
    await this.client.send('Tracing.end', {});

    // Wait for completion
    await completePromise;

    this.isTracing = false;
    this.logger.debug(
      `Tracing stopped, collected ${this.traceEvents.length} events`,
    );

    return [...this.traceEvents];
  }

  /**
   * Normalize CDP trace events to TraceSnapshot model
   */
  private normalizeToTraceSnapshot(
    events: TraceEvent[],
    options: TraceCollectionOptions,
  ): TraceSnapshot {
    const fpsTarget = options.fpsTarget ?? 60;
    const frameBudgetMs = 1000 / fpsTarget;

    // Extract frame timings
    const frameTimings = this.extractFrameTimings(events, frameBudgetMs);

    // Extract long tasks
    const longTasks = this.extractLongTasks(events);

    // Extract DOM signals
    const domSignals = this.extractDOMSignals(events);

    // Extract GPU events
    const gpuEvents = this.extractGPUEvents(events);

    // Extract paint events
    const paintEvents = this.extractPaintEvents(events);

    // Calculate duration
    const timestamps = events.filter((e) => e.ts > 0).map((e) => e.ts);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const durationMs = (maxTs - minTs) / 1000;

    // Build snapshot
    const snapshot: TraceSnapshot = {
      id: options.id ?? generateTraceId(),
      name: options.name,
      durationMs,
      frameTimings,
      frameMetrics: calculateFrameMetrics(frameTimings, fpsTarget),
      longTasks,
      domSignals,
      gpuEvents,
      paintEvents,
      metadata: {
        browserVersion: this._browserVersion,
        timestamp: new Date().toISOString(),
        fpsTarget,
        url: options.url,
        scenario: options.scenario,
        adapterType: 'chromium-cdp',
        platform: 'chromium',
      },
      rawEvents: options.includeRawEvents ? events : undefined,
    };

    return snapshot;
  }

  /**
   * Extract frame timing information from trace events
   */
  private extractFrameTimings(
    events: TraceEvent[],
    frameBudgetMs: number,
  ): FrameTiming[] {
    const frameTimings: FrameTiming[] = [];
    const frameEvents = new Map<
      number,
      { start?: number; end?: number; phases: Record<string, number> }
    >();

    // Group events by frame
    for (const event of events) {
      if (event.name === 'BeginFrame' && event.ph === 'I') {
        const frameId = frameTimings.length;
        frameEvents.set(frameId, { start: event.ts, phases: {} });
      }

      if (event.name === 'DrawFrame' && event.ph === 'I') {
        // Find the most recent frame without an end
        for (const [, frame] of frameEvents) {
          if (frame.start && !frame.end) {
            frame.end = event.ts;
            break;
          }
        }
      }

      // Track phase durations
      if (event.dur && event.dur > 0) {
        const phaseName = this.getPhaseFromEvent(event);
        if (phaseName) {
          for (const [, frame] of frameEvents) {
            if (frame.start && !frame.end && event.ts >= frame.start) {
              frame.phases[phaseName] =
                (frame.phases[phaseName] ?? 0) + event.dur / 1000;
            }
          }
        }
      }
    }

    // Convert to FrameTiming objects
    let frameIndex = 0;
    for (const [, frame] of frameEvents) {
      if (frame.start && frame.end) {
        const durationMs = (frame.end - frame.start) / 1000;
        frameTimings.push({
          frameId: frameIndex++,
          startTime: frame.start,
          endTime: frame.end,
          durationMs,
          dropped: durationMs > frameBudgetMs,
          styleRecalcMs: frame.phases['style'],
          layoutMs: frame.phases['layout'],
          paintMs: frame.phases['paint'],
          compositeMs: frame.phases['composite'],
          gpuMs: frame.phases['gpu'],
        });
      }
    }

    return frameTimings;
  }

  /**
   * Get phase name from trace event
   */
  private getPhaseFromEvent(event: TraceEvent): string | null {
    const name = event.name.toLowerCase();

    if (name.includes('recalculatestyles') || name.includes('style')) {
      return 'style';
    }
    if (name.includes('layout')) {
      return 'layout';
    }
    if (name.includes('paint')) {
      return 'paint';
    }
    if (name.includes('composite')) {
      return 'composite';
    }
    if (name.includes('gpu') || name.includes('raster')) {
      return 'gpu';
    }

    return null;
  }

  /**
   * Extract long tasks (> 50ms) from trace events
   */
  private extractLongTasks(events: TraceEvent[]): LongTaskInfo[] {
    const longTasks: LongTaskInfo[] = [];
    const LONG_TASK_THRESHOLD_MS = 50;

    for (const event of events) {
      // Look for FunctionCall or Task events with duration > 50ms
      if (
        (event.name === 'FunctionCall' ||
          event.name === 'Task' ||
          event.name === 'RunTask' ||
          event.name === 'EvaluateScript') &&
        event.dur
      ) {
        const durationMs = event.dur / 1000;

        if (durationMs > LONG_TASK_THRESHOLD_MS) {
          const args = event.args;
          const data = args?.data as Record<string, unknown> | undefined;

          longTasks.push({
            startTime: event.ts,
            durationMs,
            functionName: (data?.functionName as string) ?? event.name,
            file: data?.url as string | undefined,
            line: data?.lineNumber as number | undefined,
            column: data?.columnNumber as number | undefined,
            callStack: this.extractCallStack(data),
          });
        }
      }
    }

    return longTasks;
  }

  /**
   * Extract call stack from event data
   */
  private extractCallStack(
    data: Record<string, unknown> | undefined,
  ): StackFrameInfo[] {
    if (!data?.stackTrace) {
      return [];
    }

    const stackTrace = data.stackTrace as Array<{
      functionName?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    }>;

    return stackTrace.map((frame) => ({
      functionName: frame.functionName ?? '<anonymous>',
      file: frame.url ?? '',
      line: frame.lineNumber ?? 0,
      column: frame.columnNumber ?? 0,
    }));
  }

  /**
   * Extract DOM signals from trace events
   */
  private extractDOMSignals(events: TraceEvent[]): DOMSignal[] {
    const domSignals: DOMSignal[] = [];

    for (const event of events) {
      // Forced reflow / layout invalidation
      if (
        event.name === 'Layout' ||
        event.name === 'UpdateLayoutTree' ||
        event.name === 'InvalidateLayout'
      ) {
        const args = event.args;
        const beginData = args?.beginData as
          | Record<string, unknown>
          | undefined;

        domSignals.push({
          type:
            event.name === 'InvalidateLayout'
              ? 'layout_invalidation'
              : 'forced_reflow',
          timestamp: event.ts,
          durationMs: event.dur ? event.dur / 1000 : undefined,
          affectedNodes: beginData?.elementCount as number | undefined,
          stackTrace: this.extractCallStack(beginData),
        });
      }

      // Style recalculation
      if (event.name === 'RecalculateStyles' || event.name === 'UpdateStyles') {
        const args = event.args;
        const beginData = args?.beginData as
          | Record<string, unknown>
          | undefined;

        domSignals.push({
          type: 'style_recalc',
          timestamp: event.ts,
          durationMs: event.dur ? event.dur / 1000 : undefined,
          affectedNodes: beginData?.elementCount as number | undefined,
        });
      }
    }

    return domSignals;
  }

  /**
   * Extract GPU events from trace events
   */
  private extractGPUEvents(events: TraceEvent[]): GPUEvent[] {
    const gpuEvents: GPUEvent[] = [];

    for (const event of events) {
      if (event.cat?.includes('gpu') && event.dur) {
        let type: GPUEvent['type'] = 'composite';

        if (event.name.toLowerCase().includes('sync')) {
          type = 'sync';
        } else if (event.name.toLowerCase().includes('texture')) {
          type = 'texture_upload';
        } else if (event.name.toLowerCase().includes('raster')) {
          type = 'raster';
        }

        gpuEvents.push({
          type,
          timestamp: event.ts,
          durationMs: event.dur / 1000,
        });
      }
    }

    return gpuEvents;
  }

  /**
   * Extract paint events from trace events
   */
  private extractPaintEvents(events: TraceEvent[]): PaintEvent[] {
    const paintEvents: PaintEvent[] = [];

    for (const event of events) {
      if (event.name === 'Paint' && event.dur) {
        const args = event.args;
        const data = args?.data as Record<string, unknown> | undefined;
        const clip = data?.clip as number[] | undefined;

        paintEvents.push({
          timestamp: event.ts,
          paintDurationMs: event.dur / 1000,
          bounds: clip
            ? {
                x: clip[0] ?? 0,
                y: clip[1] ?? 0,
                width: (clip[2] ?? 0) - (clip[0] ?? 0),
                height: (clip[3] ?? 0) - (clip[1] ?? 0),
              }
            : undefined,
        });
      }

      // Also capture rasterization
      if (event.name === 'RasterTask' && event.dur) {
        const lastPaint = paintEvents[paintEvents.length - 1];
        if (lastPaint && !lastPaint.rasterDurationMs) {
          lastPaint.rasterDurationMs = event.dur / 1000;
        }
      }
    }

    return paintEvents;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function for creating ChromiumCDPAdapter instances
 */
export function createChromiumCDPAdapter(): ChromiumCDPAdapter {
  return new ChromiumCDPAdapter();
}
