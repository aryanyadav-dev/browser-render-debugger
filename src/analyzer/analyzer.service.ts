/**
 * Analyzer service for trace analysis and detection orchestration
 *
 * Supports both raw CDP TraceData and normalized TraceSnapshot for
 * platform-agnostic analysis across different browser adapters.
 *
 * Requirements: 15.20, 15.21
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  TraceData,
  TraceSummary,
  FrameMetrics,
  Detection,
  Hotspots,
  LayoutThrashDetection,
  GPUStallDetection,
  LongTaskDetection,
  TraceEvent,
} from '../shared/types/index.js';
import type {
  TraceSnapshot,
  DOMSignal,
  GPUEvent,
} from '../adapters/models/index.js';
import { AdapterCapability } from '../adapters/interfaces/index.js';
import type {
  IDetector,
  IAnalyzerService,
  AnalyzeOptions,
  AnalysisResult,
  AnalysisWarning,
  DetectionContext,
  TraceSnapshotDetectionContext,
} from './interfaces/index.js';

/**
 * Capability requirements for each detector type
 */
const DETECTOR_CAPABILITY_REQUIREMENTS: Record<string, AdapterCapability[]> = {
  LayoutThrashDetector: [AdapterCapability.DOM_SIGNALS],
  GPUStallDetector: [AdapterCapability.GPU_EVENTS, AdapterCapability.FULL_CDP],
  LongTaskDetector: [AdapterCapability.LONG_TASKS],
  HeavyPaintDetector: [AdapterCapability.PAINT_EVENTS],
};

@Injectable()
export class AnalyzerService implements IAnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);
  private detectors: IDetector[] = [];

  /**
   * Register a detector for analysis
   */
  registerDetector(detector: IDetector): void {
    this.detectors.push(detector);
    // Sort by priority (lower number = higher priority)
    this.detectors.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get all registered detectors
   */
  getDetectors(): IDetector[] {
    return [...this.detectors];
  }

  /**
   * Analyze raw CDP trace data (backward compatible)
   */
  async analyze(
    trace: TraceData,
    options: AnalyzeOptions,
  ): Promise<AnalysisResult> {
    const frameBudgetMs = 1000 / options.fpsTarget;
    const frameMetrics = this.calculateFrameMetrics(trace, options.fpsTarget);
    const { startTime, endTime } = this.getTraceTimeRange(trace);

    // Default to full CDP capabilities for raw trace data
    const capabilities = options.adapterCapabilities ?? [
      AdapterCapability.FULL_CDP,
      AdapterCapability.FRAME_TIMING,
      AdapterCapability.LONG_TASKS,
      AdapterCapability.DOM_SIGNALS,
      AdapterCapability.GPU_EVENTS,
      AdapterCapability.PAINT_EVENTS,
    ];

    const context: DetectionContext = {
      fpsTarget: options.fpsTarget,
      frameBudgetMs,
      frameMetrics,
      traceStartTime: startTime,
      traceEndTime: endTime,
      capabilities,
      degradedMode: false,
    };

    // Run detectors with capability checking
    const { detections, warnings } = await this.runDetectors(
      trace,
      context,
      capabilities,
    );

    // Build hotspots from detections
    const hotspots = this.buildHotspots(detections);

    // Build summary
    const summary = this.buildSummary(trace, options, frameMetrics, hotspots);

    return {
      summary,
      detections,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Analyze normalized TraceSnapshot (platform-agnostic)
   */
  async analyzeSnapshot(
    snapshot: TraceSnapshot,
    options: AnalyzeOptions,
  ): Promise<AnalysisResult> {
    const frameBudgetMs = 1000 / options.fpsTarget;

    // Convert TraceSnapshot frame metrics to legacy format
    const frameMetrics: FrameMetrics = {
      total: snapshot.frameMetrics.totalFrames,
      dropped: snapshot.frameMetrics.droppedFrames,
      avg_fps: snapshot.frameMetrics.avgFps,
      frame_budget_ms: frameBudgetMs,
    };

    // Calculate time range from snapshot
    const startTime = snapshot.frameTimings[0]?.startTime ?? 0;
    const endTime =
      snapshot.frameTimings[snapshot.frameTimings.length - 1]?.endTime ??
      startTime + snapshot.durationMs * 1000;

    // Determine capabilities from adapter type or provided options
    const capabilities =
      options.adapterCapabilities ??
      this.inferCapabilitiesFromSnapshot(snapshot);

    const context: TraceSnapshotDetectionContext = {
      fpsTarget: options.fpsTarget,
      frameBudgetMs,
      frameMetrics,
      traceStartTime: startTime,
      traceEndTime: endTime,
      capabilities,
      degradedMode: !capabilities.includes(AdapterCapability.FULL_CDP),
      snapshotMetrics: snapshot.frameMetrics,
      adapterType: snapshot.metadata.adapterType,
      platform: snapshot.metadata.platform,
    };

    // Convert snapshot to TraceData for backward compatibility with detectors
    const traceData = this.convertSnapshotToTraceData(snapshot);

    // Run detectors with capability checking
    const { detections, warnings } = await this.runDetectorsWithSnapshot(
      snapshot,
      traceData,
      context,
      capabilities,
    );

    // Build hotspots from detections
    const hotspots = this.buildHotspots(detections);

    // Build summary from snapshot
    const summary = this.buildSummaryFromSnapshot(
      snapshot,
      options,
      frameMetrics,
      hotspots,
    );

    return {
      summary,
      detections,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Run detectors with capability checking (for raw TraceData)
   */
  private async runDetectors(
    trace: TraceData,
    context: DetectionContext,
    capabilities: AdapterCapability[],
  ): Promise<{ detections: Detection[]; warnings: AnalysisWarning[] }> {
    const allDetections: Detection[] = [];
    const warnings: AnalysisWarning[] = [];
    const skippedDetectors: string[] = [];

    for (const detector of this.detectors) {
      // Check if detector can run with available capabilities
      const canRun = this.canDetectorRun(detector, capabilities);

      if (!canRun.allowed) {
        this.logger.warn(`Skipping ${detector.name}: ${canRun.reason}`);
        skippedDetectors.push(detector.name);
        continue;
      }

      try {
        const detections = await detector.detect(trace, context);
        allDetections.push(...detections);
      } catch (error) {
        this.logger.error(
          `Detector ${detector.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Add warning if detectors were skipped
    if (skippedDetectors.length > 0) {
      warnings.push(
        this.createCapabilityWarning(skippedDetectors, capabilities),
      );
    }

    return { detections: allDetections, warnings };
  }

  /**
   * Run detectors with capability checking (for TraceSnapshot)
   */
  private async runDetectorsWithSnapshot(
    snapshot: TraceSnapshot,
    traceData: TraceData,
    context: TraceSnapshotDetectionContext,
    capabilities: AdapterCapability[],
  ): Promise<{ detections: Detection[]; warnings: AnalysisWarning[] }> {
    const allDetections: Detection[] = [];
    const warnings: AnalysisWarning[] = [];
    const skippedDetectors: string[] = [];

    for (const detector of this.detectors) {
      // Check if detector can run with available capabilities
      const canRun = this.canDetectorRun(detector, capabilities);

      if (!canRun.allowed) {
        this.logger.warn(`Skipping ${detector.name}: ${canRun.reason}`);
        skippedDetectors.push(detector.name);
        continue;
      }

      try {
        let detections: Detection[];

        // Prefer detectFromSnapshot if available
        if (detector.detectFromSnapshot) {
          detections = await detector.detectFromSnapshot(snapshot, context);
        } else {
          // Fall back to detect() with converted TraceData
          detections = await detector.detect(traceData, context);
        }

        allDetections.push(...detections);
      } catch (error) {
        this.logger.error(
          `Detector ${detector.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Add warning if detectors were skipped
    if (skippedDetectors.length > 0) {
      warnings.push(
        this.createCapabilityWarning(skippedDetectors, capabilities),
      );
    }

    return { detections: allDetections, warnings };
  }

  /**
   * Check if a detector can run with the available capabilities
   */
  private canDetectorRun(
    detector: IDetector,
    capabilities: AdapterCapability[],
  ): { allowed: boolean; reason?: string } {
    // Check detector's own required capabilities
    if (detector.requiredCapabilities) {
      const missing = detector.requiredCapabilities.filter(
        (cap) => !capabilities.includes(cap),
      );
      if (missing.length > 0) {
        return {
          allowed: false,
          reason: `Missing required capabilities: ${missing.join(', ')}`,
        };
      }
    }

    // Check predefined capability requirements
    const requirements = DETECTOR_CAPABILITY_REQUIREMENTS[detector.name];
    if (requirements) {
      // For GPU stall detector, require FULL_CDP or GPU_EVENTS
      if (detector.name === 'GPUStallDetector') {
        const hasGpuCapability =
          capabilities.includes(AdapterCapability.FULL_CDP) ||
          capabilities.includes(AdapterCapability.GPU_EVENTS);
        if (!hasGpuCapability) {
          return {
            allowed: false,
            reason:
              'GPU stall detection requires full CDP access or GPU event capability',
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Create a warning for skipped detectors due to capability limitations
   */
  private createCapabilityWarning(
    skippedDetectors: string[],
    capabilities: AdapterCapability[],
  ): AnalysisWarning {
    const suggestions: string[] = [];

    // Suggest using CDP adapter for full analysis
    if (!capabilities.includes(AdapterCapability.FULL_CDP)) {
      suggestions.push(
        'Use the chromium-cdp adapter with a staging/dev browser build for full analysis',
      );
    }

    // Specific suggestions based on skipped detectors
    if (skippedDetectors.includes('GPUStallDetector')) {
      suggestions.push(
        'GPU stall detection requires CDP access - native adapters have limited GPU visibility',
      );
    }

    return {
      code: 'DEGRADED_ANALYSIS',
      message: `Analysis running in degraded mode. ${skippedDetectors.length} detector(s) skipped due to limited adapter capabilities.`,
      affectedDetectors: skippedDetectors,
      suggestions,
    };
  }

  /**
   * Infer capabilities from TraceSnapshot metadata
   */
  private inferCapabilitiesFromSnapshot(
    snapshot: TraceSnapshot,
  ): AdapterCapability[] {
    const capabilities: AdapterCapability[] = [];

    // Always have frame timing if we have frame timings
    if (snapshot.frameTimings.length > 0) {
      capabilities.push(AdapterCapability.FRAME_TIMING);
    }

    // Check for long tasks
    if (snapshot.longTasks.length > 0) {
      capabilities.push(AdapterCapability.LONG_TASKS);
    }

    // Check for DOM signals
    if (snapshot.domSignals.length > 0) {
      capabilities.push(AdapterCapability.DOM_SIGNALS);
    }

    // Check for GPU events
    if (snapshot.gpuEvents.length > 0) {
      capabilities.push(AdapterCapability.GPU_EVENTS);
    }

    // Check for paint events
    if (snapshot.paintEvents.length > 0) {
      capabilities.push(AdapterCapability.PAINT_EVENTS);
    }

    // Check adapter type for full CDP
    if (snapshot.metadata.adapterType === 'chromium-cdp') {
      capabilities.push(AdapterCapability.FULL_CDP);
    }

    return capabilities;
  }

  /**
   * Convert TraceSnapshot to TraceData for backward compatibility
   */
  private convertSnapshotToTraceData(snapshot: TraceSnapshot): TraceData {
    const traceEvents: TraceEvent[] = [];

    // Convert frame timings to BeginFrame events
    for (const frame of snapshot.frameTimings) {
      traceEvents.push({
        pid: 1,
        tid: 1,
        ts: frame.startTime,
        ph: 'B',
        cat: 'devtools.timeline',
        name: 'BeginFrame',
        args: { frameId: frame.frameId },
      });

      // Add phase events if available
      if (frame.layoutMs && frame.layoutMs > 0) {
        traceEvents.push({
          pid: 1,
          tid: 1,
          ts: frame.startTime,
          ph: 'X',
          cat: 'devtools.timeline',
          name: 'Layout',
          dur: frame.layoutMs * 1000,
        });
      }

      if (frame.paintMs && frame.paintMs > 0) {
        traceEvents.push({
          pid: 1,
          tid: 1,
          ts: frame.startTime,
          ph: 'X',
          cat: 'devtools.timeline',
          name: 'Paint',
          dur: frame.paintMs * 1000,
        });
      }
    }

    // Convert long tasks
    for (const task of snapshot.longTasks) {
      traceEvents.push({
        pid: 1,
        tid: 1,
        ts: task.startTime,
        ph: 'X',
        cat: 'devtools.timeline',
        name: 'FunctionCall',
        dur: task.durationMs * 1000,
        args: {
          data: {
            functionName: task.functionName ?? 'anonymous',
            scriptName: task.file,
            lineNumber: task.line,
            columnNumber: task.column,
            stackTrace: task.callStack?.map((frame) => ({
              functionName: frame.functionName,
              url: frame.file,
              lineNumber: frame.line,
              columnNumber: frame.column,
            })),
          },
        },
      });
    }

    // Convert DOM signals
    for (const signal of snapshot.domSignals) {
      const eventName = this.domSignalTypeToEventName(signal.type);
      traceEvents.push({
        pid: 1,
        tid: 1,
        ts: signal.timestamp,
        ph: 'X',
        cat: 'devtools.timeline',
        name: eventName,
        dur: (signal.durationMs ?? 0) * 1000,
        args: {
          data: {
            selector: signal.selector,
            nodeCount: signal.affectedNodes,
          },
        },
      });
    }

    // Convert GPU events
    for (const gpuEvent of snapshot.gpuEvents) {
      const eventName = this.gpuEventTypeToEventName(gpuEvent.type);
      traceEvents.push({
        pid: 1,
        tid: 1,
        ts: gpuEvent.timestamp,
        ph: 'X',
        cat: 'gpu',
        name: eventName,
        dur: gpuEvent.durationMs * 1000,
        args: {
          data: {
            elementId: gpuEvent.element,
            layerId: gpuEvent.layerId,
          },
        },
      });
    }

    // Convert paint events
    for (const paintEvent of snapshot.paintEvents) {
      traceEvents.push({
        pid: 1,
        tid: 1,
        ts: paintEvent.timestamp,
        ph: 'X',
        cat: 'devtools.timeline',
        name: 'Paint',
        dur: paintEvent.paintDurationMs * 1000,
        args: {
          data: {
            clip: paintEvent.bounds,
            layerCount: paintEvent.layerCount,
          },
        },
      });

      if (paintEvent.rasterDurationMs && paintEvent.rasterDurationMs > 0) {
        traceEvents.push({
          pid: 1,
          tid: 1,
          ts: paintEvent.timestamp,
          ph: 'X',
          cat: 'devtools.timeline',
          name: 'RasterTask',
          dur: paintEvent.rasterDurationMs * 1000,
        });
      }
    }

    // Sort events by timestamp
    traceEvents.sort((a, b) => a.ts - b.ts);

    return {
      traceEvents,
      metadata: {
        browser_version: snapshot.metadata.browserVersion ?? 'unknown',
        user_agent: snapshot.metadata.userAgent ?? 'unknown',
        viewport: snapshot.metadata.viewport ?? { width: 0, height: 0 },
        device_pixel_ratio: snapshot.metadata.devicePixelRatio ?? 1,
        timestamp: snapshot.metadata.timestamp,
        scenario: snapshot.metadata.scenario ?? snapshot.name,
        fps_target: snapshot.metadata.fpsTarget,
      },
    };
  }

  /**
   * Convert DOM signal type to trace event name
   */
  private domSignalTypeToEventName(type: DOMSignal['type']): string {
    switch (type) {
      case 'forced_reflow':
        return 'Layout';
      case 'style_recalc':
        return 'RecalculateStyles';
      case 'layout_invalidation':
        return 'InvalidateLayout';
      case 'dom_mutation':
        return 'UpdateLayoutTree';
      default:
        return 'Layout';
    }
  }

  /**
   * Convert GPU event type to trace event name
   */
  private gpuEventTypeToEventName(type: GPUEvent['type']): string {
    switch (type) {
      case 'sync':
        return 'GPUTask';
      case 'texture_upload':
        return 'UploadTexture';
      case 'raster':
        return 'RasterTask';
      case 'composite':
        return 'CompositeLayers';
      default:
        return 'GPUTask';
    }
  }

  /**
   * Calculate frame metrics from trace data
   */
  calculateFrameMetrics(trace: TraceData, fpsTarget: number): FrameMetrics {
    const frameBudgetMs = 1000 / fpsTarget;
    const frames = this.extractFrames(trace);

    if (frames.length === 0) {
      return {
        total: 0,
        dropped: 0,
        avg_fps: 0,
        frame_budget_ms: frameBudgetMs,
      };
    }

    // Calculate frame durations
    const frameDurations: number[] = [];
    for (let i = 1; i < frames.length; i++) {
      const current = frames[i];
      const prev = frames[i - 1];
      if (current && prev) {
        const durationMs = (current.ts - prev.ts) / 1000;
        frameDurations.push(durationMs);
      }
    }

    const totalFrames = Math.max(frameDurations.length, 1);
    const droppedFrames = frameDurations.filter(
      (d) => d > frameBudgetMs,
    ).length;
    const avgFrameTime =
      frameDurations.length > 0
        ? frameDurations.reduce((a, b) => a + b, 0) / frameDurations.length
        : frameBudgetMs;
    const avgFps = avgFrameTime > 0 ? 1000 / avgFrameTime : fpsTarget;

    return {
      total: totalFrames,
      dropped: droppedFrames,
      avg_fps: Math.round(avgFps * 10) / 10,
      frame_budget_ms: frameBudgetMs,
    };
  }

  /**
   * Extract frame events from trace
   */
  extractFrames(
    trace: TraceData,
  ): Array<{ ts: number; frameId?: number; dropped?: boolean }> {
    const frameEvents = trace.traceEvents.filter(
      (e) =>
        e.name === 'BeginFrame' ||
        e.name === 'DrawFrame' ||
        e.name === 'BeginMainThreadFrame',
    );

    return frameEvents.map((e, index) => ({
      ts: e.ts,
      frameId: index,
      dropped: false,
    }));
  }

  /**
   * Get trace time range
   */
  private getTraceTimeRange(trace: TraceData): {
    startTime: number;
    endTime: number;
  } {
    if (trace.traceEvents.length === 0) {
      return { startTime: 0, endTime: 0 };
    }

    let startTime = Infinity;
    let endTime = -Infinity;

    for (const event of trace.traceEvents) {
      if (event.ts < startTime) startTime = event.ts;
      const eventEnd = event.ts + (event.dur ?? 0);
      if (eventEnd > endTime) endTime = eventEnd;
    }

    return { startTime, endTime };
  }

  /**
   * Build hotspots from detections
   */
  private buildHotspots(detections: Detection[]): Hotspots {
    const layoutThrashing = detections
      .filter((d): d is LayoutThrashDetection => d.type === 'layout_thrashing')
      .map((d) => ({
        selector: d.selector,
        reflow_cost_ms: d.reflowCostMs,
        occurrences: d.occurrences,
        affected_nodes: d.affectedNodes,
      }));

    const gpuStalls = detections
      .filter((d): d is GPUStallDetection => d.type === 'gpu_stall')
      .map((d) => ({
        element: d.element,
        stall_ms: d.stallMs,
        occurrences: d.occurrences,
      }));

    const longTasks = detections
      .filter((d): d is LongTaskDetection => d.type === 'long_task')
      .map((d) => ({
        function: d.functionName,
        file: d.file,
        line: d.line,
        cpu_ms: d.cpuMs,
        occurrences: d.occurrences,
      }));

    return {
      layout_thrashing: layoutThrashing,
      gpu_stalls: gpuStalls,
      long_tasks: longTasks,
    };
  }

  /**
   * Build trace summary from raw TraceData
   */
  private buildSummary(
    trace: TraceData,
    options: AnalyzeOptions,
    frameMetrics: FrameMetrics,
    hotspots: Hotspots,
  ): TraceSummary {
    const phaseBreakdown = this.calculatePhaseBreakdown(trace);
    const { startTime, endTime } = this.getTraceTimeRange(trace);
    const durationMs = (endTime - startTime) / 1000;

    return {
      id: this.generateUniqueId(),
      name: options.name,
      url: trace.metadata?.user_agent ?? 'unknown',
      duration_ms: durationMs,
      frames: frameMetrics,
      phase_breakdown: phaseBreakdown,
      hotspots,
      suggestions: [],
      metadata: trace.metadata ?? {
        browser_version: 'unknown',
        user_agent: 'unknown',
        viewport: { width: 0, height: 0 },
        device_pixel_ratio: 1,
        timestamp: new Date().toISOString(),
        scenario: options.name,
        fps_target: options.fpsTarget,
      },
    };
  }

  /**
   * Build trace summary from TraceSnapshot
   */
  private buildSummaryFromSnapshot(
    snapshot: TraceSnapshot,
    options: AnalyzeOptions,
    frameMetrics: FrameMetrics,
    hotspots: Hotspots,
  ): TraceSummary {
    const phaseBreakdown = this.calculatePhaseBreakdownFromSnapshot(snapshot);

    return {
      id: snapshot.id,
      name: options.name,
      url: snapshot.metadata.url ?? 'unknown',
      duration_ms: snapshot.durationMs,
      frames: frameMetrics,
      phase_breakdown: phaseBreakdown,
      hotspots,
      suggestions: [],
      metadata: {
        browser_version: snapshot.metadata.browserVersion ?? 'unknown',
        user_agent: snapshot.metadata.userAgent ?? 'unknown',
        viewport: snapshot.metadata.viewport ?? { width: 0, height: 0 },
        device_pixel_ratio: snapshot.metadata.devicePixelRatio ?? 1,
        timestamp: snapshot.metadata.timestamp,
        scenario: snapshot.metadata.scenario ?? options.name,
        fps_target: options.fpsTarget,
      },
    };
  }

  /**
   * Calculate phase breakdown from trace data
   */
  private calculatePhaseBreakdown(
    trace: TraceData,
  ): TraceSummary['phase_breakdown'] {
    let styleRecalcMs = 0;
    let layoutMs = 0;
    let paintMs = 0;
    let compositeMs = 0;
    let gpuMs = 0;

    for (const event of trace.traceEvents) {
      const durationMs = (event.dur ?? 0) / 1000;

      switch (event.name) {
        case 'UpdateLayoutTree':
        case 'RecalculateStyles':
          styleRecalcMs += durationMs;
          break;
        case 'Layout':
          layoutMs += durationMs;
          break;
        case 'Paint':
        case 'PaintImage':
          paintMs += durationMs;
          break;
        case 'CompositeLayers':
        case 'UpdateLayer':
          compositeMs += durationMs;
          break;
        case 'GPUTask':
        case 'RasterTask':
          gpuMs += durationMs;
          break;
      }
    }

    return {
      style_recalc_ms: Math.round(styleRecalcMs * 100) / 100,
      layout_ms: Math.round(layoutMs * 100) / 100,
      paint_ms: Math.round(paintMs * 100) / 100,
      composite_ms: Math.round(compositeMs * 100) / 100,
      gpu_ms: Math.round(gpuMs * 100) / 100,
    };
  }

  /**
   * Calculate phase breakdown from TraceSnapshot
   */
  private calculatePhaseBreakdownFromSnapshot(
    snapshot: TraceSnapshot,
  ): TraceSummary['phase_breakdown'] {
    let styleRecalcMs = 0;
    let layoutMs = 0;
    let paintMs = 0;
    let compositeMs = 0;
    let gpuMs = 0;

    // Aggregate from frame timings
    for (const frame of snapshot.frameTimings) {
      styleRecalcMs += frame.styleRecalcMs ?? 0;
      layoutMs += frame.layoutMs ?? 0;
      paintMs += frame.paintMs ?? 0;
      compositeMs += frame.compositeMs ?? 0;
      gpuMs += frame.gpuMs ?? 0;
    }

    // Add from GPU events
    for (const gpuEvent of snapshot.gpuEvents) {
      if (gpuEvent.type === 'composite') {
        compositeMs += gpuEvent.durationMs;
      } else {
        gpuMs += gpuEvent.durationMs;
      }
    }

    // Add from paint events
    for (const paintEvent of snapshot.paintEvents) {
      paintMs += paintEvent.paintDurationMs;
      gpuMs += paintEvent.rasterDurationMs ?? 0;
    }

    return {
      style_recalc_ms: Math.round(styleRecalcMs * 100) / 100,
      layout_ms: Math.round(layoutMs * 100) / 100,
      paint_ms: Math.round(paintMs * 100) / 100,
      composite_ms: Math.round(compositeMs * 100) / 100,
      gpu_ms: Math.round(gpuMs * 100) / 100,
    };
  }

  /**
   * Generate unique ID
   */
  private generateUniqueId(): string {
    return `analysis-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
