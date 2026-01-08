/**
 * TraceSnapshot - Platform-agnostic trace data model
 *
 * This model defines a common interface that all browser adapters normalize to,
 * enabling the analyzer to work with traces from different sources (CDP, native WebKit, etc.)
 *
 * Requirements: 15.1, 15.2
 */

/**
 * Frame timing information for a single frame
 */
export interface FrameTiming {
  /** Frame sequence number */
  frameId: number;
  /** Frame start timestamp in microseconds */
  startTime: number;
  /** Frame end timestamp in microseconds */
  endTime: number;
  /** Frame duration in milliseconds */
  durationMs: number;
  /** Whether this frame was dropped (exceeded budget) */
  dropped: boolean;
  /** Time spent in style recalculation (ms) */
  styleRecalcMs?: number;
  /** Time spent in layout (ms) */
  layoutMs?: number;
  /** Time spent in paint (ms) */
  paintMs?: number;
  /** Time spent in composite (ms) */
  compositeMs?: number;
  /** Time spent in GPU operations (ms) */
  gpuMs?: number;
}

/**
 * Aggregated frame metrics
 */
export interface FrameMetricsSummary {
  /** Total number of frames */
  totalFrames: number;
  /** Number of dropped frames */
  droppedFrames: number;
  /** Average frames per second */
  avgFps: number;
  /** Frame budget in milliseconds (based on target FPS) */
  frameBudgetMs: number;
  /** 95th percentile frame time in milliseconds */
  p95FrameTimeMs: number;
  /** Maximum frame time in milliseconds */
  maxFrameTimeMs: number;
  /** Minimum frame time in milliseconds */
  minFrameTimeMs: number;
}

/**
 * Long task information (tasks > 50ms blocking main thread)
 */
export interface LongTaskInfo {
  /** Task start timestamp in microseconds */
  startTime: number;
  /** Task duration in milliseconds */
  durationMs: number;
  /** Function name if available */
  functionName?: string;
  /** Source file if available */
  file?: string;
  /** Line number if available */
  line?: number;
  /** Column number if available */
  column?: number;
  /** Call stack frames if available */
  callStack?: StackFrameInfo[];
  /** Associated frame ID if correlated */
  correlatedFrameId?: number;
}

/**
 * Stack frame information
 */
export interface StackFrameInfo {
  functionName: string;
  file: string;
  line: number;
  column: number;
}

/**
 * DOM signal types for layout/style issues
 */
export type DOMSignalType =
  | 'forced_reflow'
  | 'style_recalc'
  | 'layout_invalidation'
  | 'dom_mutation';

/**
 * DOM signal information for detecting layout thrashing and style issues
 */
export interface DOMSignal {
  /** Type of DOM signal */
  type: DOMSignalType;
  /** Timestamp in microseconds */
  timestamp: number;
  /** Duration in milliseconds if applicable */
  durationMs?: number;
  /** CSS selector if available */
  selector?: string;
  /** Number of affected DOM nodes */
  affectedNodes?: number;
  /** Associated frame ID */
  frameId?: number;
  /** Stack trace if available */
  stackTrace?: StackFrameInfo[];
  /** Additional properties (read/write for layout thrashing detection) */
  properties?: {
    name: string;
    accessType: 'read' | 'write';
  }[];
}

/**
 * GPU event information
 */
export interface GPUEvent {
  /** Event type */
  type: 'sync' | 'texture_upload' | 'raster' | 'composite';
  /** Timestamp in microseconds */
  timestamp: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Associated element/layer if available */
  element?: string;
  /** Layer ID if available */
  layerId?: number;
  /** Associated frame ID */
  frameId?: number;
}

/**
 * Paint event information
 */
export interface PaintEvent {
  /** Timestamp in microseconds */
  timestamp: number;
  /** Paint duration in milliseconds */
  paintDurationMs: number;
  /** Rasterization duration in milliseconds */
  rasterDurationMs?: number;
  /** Painted area bounds */
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Number of layers involved */
  layerCount?: number;
  /** Associated frame ID */
  frameId?: number;
}

/**
 * Metadata about the trace collection environment
 */
export interface TraceSnapshotMetadata {
  /** Browser name and version */
  browserVersion?: string;
  /** User agent string */
  userAgent?: string;
  /** Viewport dimensions */
  viewport?: {
    width: number;
    height: number;
  };
  /** Device pixel ratio */
  devicePixelRatio?: number;
  /** Trace collection timestamp (ISO string) */
  timestamp: string;
  /** Scenario name if applicable */
  scenario?: string;
  /** Target FPS used for analysis */
  fpsTarget: number;
  /** URL being profiled */
  url?: string;
  /** Adapter that collected this trace */
  adapterType: string;
  /** Platform (chromium, webkit, etc.) */
  platform: string;
}

/**
 * TraceSnapshot - The unified trace data model
 *
 * All browser adapters normalize their native trace formats to this model,
 * enabling platform-agnostic analysis.
 */
export interface TraceSnapshot {
  /** Unique identifier for this trace */
  id: string;
  /** Human-readable name for this trace run */
  name: string;
  /** Total trace duration in milliseconds */
  durationMs: number;

  /** Frame timing data */
  frameTimings: FrameTiming[];

  /** Aggregated frame metrics */
  frameMetrics: FrameMetricsSummary;

  /** Long tasks detected (> 50ms) */
  longTasks: LongTaskInfo[];

  /** DOM signals for layout/style analysis */
  domSignals: DOMSignal[];

  /** GPU events */
  gpuEvents: GPUEvent[];

  /** Paint events */
  paintEvents: PaintEvent[];

  /** Trace metadata */
  metadata: TraceSnapshotMetadata;

  /** Raw trace events (optional, for debugging) */
  rawEvents?: unknown[];
}

/**
 * Options for creating a TraceSnapshot
 */
export interface TraceSnapshotOptions {
  /** Unique ID (auto-generated if not provided) */
  id?: string;
  /** Name for this trace run */
  name: string;
  /** Target FPS for frame budget calculation */
  fpsTarget?: number;
  /** Whether to include raw events */
  includeRawEvents?: boolean;
}

/**
 * Helper function to calculate frame metrics from frame timings
 */
export function calculateFrameMetrics(
  frameTimings: FrameTiming[],
  fpsTarget: number,
): FrameMetricsSummary {
  if (frameTimings.length === 0) {
    return {
      totalFrames: 0,
      droppedFrames: 0,
      avgFps: 0,
      frameBudgetMs: 1000 / fpsTarget,
      p95FrameTimeMs: 0,
      maxFrameTimeMs: 0,
      minFrameTimeMs: 0,
    };
  }

  const frameBudgetMs = 1000 / fpsTarget;
  const droppedFrames = frameTimings.filter((f) => f.dropped).length;

  // Calculate duration-based FPS
  const totalDurationMs = frameTimings.reduce(
    (sum, f) => sum + f.durationMs,
    0,
  );
  const avgFps =
    totalDurationMs > 0 ? (frameTimings.length / totalDurationMs) * 1000 : 0;

  // Sort durations for percentile calculation
  const sortedDurations = frameTimings
    .map((f) => f.durationMs)
    .sort((a, b) => a - b);

  const p95Index = Math.floor(sortedDurations.length * 0.95);
  const p95FrameTimeMs = sortedDurations[p95Index] ?? 0;
  const maxFrameTimeMs = sortedDurations[sortedDurations.length - 1] ?? 0;
  const minFrameTimeMs = sortedDurations[0] ?? 0;

  return {
    totalFrames: frameTimings.length,
    droppedFrames,
    avgFps: Math.round(avgFps * 100) / 100,
    frameBudgetMs,
    p95FrameTimeMs,
    maxFrameTimeMs,
    minFrameTimeMs,
  };
}

/**
 * Helper function to generate a unique trace ID
 */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `trace-${timestamp}-${random}`;
}

/**
 * Helper function to create an empty TraceSnapshot
 */
export function createEmptyTraceSnapshot(
  options: TraceSnapshotOptions,
): TraceSnapshot {
  const fpsTarget = options.fpsTarget ?? 60;
  const id = options.id ?? generateTraceId();

  return {
    id,
    name: options.name,
    durationMs: 0,
    frameTimings: [],
    frameMetrics: calculateFrameMetrics([], fpsTarget),
    longTasks: [],
    domSignals: [],
    gpuEvents: [],
    paintEvents: [],
    metadata: {
      timestamp: new Date().toISOString(),
      fpsTarget,
      adapterType: 'unknown',
      platform: 'unknown',
    },
  };
}
