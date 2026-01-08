/**
 * Analyzer interfaces for trace analysis and detection
 *
 * Supports both raw CDP TraceData and normalized TraceSnapshot for
 * platform-agnostic analysis across different browser adapters.
 *
 * Requirements: 15.20, 15.21
 */

import type {
  TraceData,
  TraceSummary,
  FrameMetrics,
  Detection,
} from '../../shared/types/index.js';
import type {
  TraceSnapshot,
  FrameMetricsSummary,
} from '../../adapters/models/index.js';
import type { AdapterCapability } from '../../adapters/interfaces/index.js';

/**
 * Options for trace analysis
 */
export interface AnalyzeOptions {
  name: string;
  fpsTarget: number;
  sourceMapPaths?: string[];
  /** Adapter capabilities for capability-aware analysis */
  adapterCapabilities?: AdapterCapability[];
  /** Adapter type for logging/reporting */
  adapterType?: string;
}

/**
 * Analysis result with optional warnings
 */
export interface AnalysisResult {
  summary: TraceSummary;
  detections: Detection[];
  /** Warnings about limited analysis due to adapter capabilities */
  warnings?: AnalysisWarning[];
}

/**
 * Warning about limited analysis capabilities
 */
export interface AnalysisWarning {
  /** Warning code for programmatic handling */
  code: string;
  /** Human-readable warning message */
  message: string;
  /** Detectors that were skipped or limited */
  affectedDetectors?: string[];
  /** Suggested actions to get full analysis */
  suggestions?: string[];
}

/**
 * Detection context with capability information
 */
export interface DetectionContext {
  fpsTarget: number;
  frameBudgetMs: number;
  frameMetrics: FrameMetrics;
  traceStartTime: number;
  traceEndTime: number;
  /** Available adapter capabilities */
  capabilities?: AdapterCapability[];
  /** Whether running in degraded mode */
  degradedMode?: boolean;
}

/**
 * Extended detection context for TraceSnapshot-based analysis
 */
export interface TraceSnapshotDetectionContext extends DetectionContext {
  /** Frame metrics from TraceSnapshot */
  snapshotMetrics: FrameMetricsSummary;
  /** Adapter type that collected the trace */
  adapterType: string;
  /** Platform identifier */
  platform: string;
}

/**
 * Detector interface for trace analysis
 */
export interface IDetector {
  readonly name: string;
  readonly priority: number;
  /** Required capabilities for this detector to run */
  readonly requiredCapabilities?: AdapterCapability[];
  /**
   * Detect issues in trace data
   * @param trace Raw CDP trace data
   * @param context Detection context
   */
  detect(trace: TraceData, context: DetectionContext): Promise<Detection[]>;
  /**
   * Detect issues in normalized TraceSnapshot
   * Optional - if not implemented, falls back to detect() with converted data
   * @param snapshot Normalized trace snapshot
   * @param context Detection context
   */
  detectFromSnapshot?(
    snapshot: TraceSnapshot,
    context: TraceSnapshotDetectionContext,
  ): Promise<Detection[]>;
}

/**
 * Analyzer service interface
 */
export interface IAnalyzerService {
  /**
   * Analyze raw CDP trace data (backward compatible)
   */
  analyze(trace: TraceData, options: AnalyzeOptions): Promise<AnalysisResult>;
  /**
   * Analyze normalized TraceSnapshot (platform-agnostic)
   */
  analyzeSnapshot(
    snapshot: TraceSnapshot,
    options: AnalyzeOptions,
  ): Promise<AnalysisResult>;
  getDetectors(): IDetector[];
  registerDetector(detector: IDetector): void;
}
