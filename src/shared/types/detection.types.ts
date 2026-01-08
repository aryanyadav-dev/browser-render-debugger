/**
 * Detection types for performance issue identification
 */

import type { TraceEvent } from './trace.types.js';

export type DetectionType =
  | 'layout_thrashing'
  | 'gpu_stall'
  | 'long_task'
  | 'heavy_paint'
  | 'forced_reflow';

export type Severity = 'info' | 'warning' | 'high' | 'critical';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DetectionLocation {
  file?: string;
  line?: number;
  column?: number;
  selector?: string;
  element?: string;
}

/**
 * Risk assessment for prioritization
 */
export interface RiskAssessment {
  /** User experience impact level */
  userExperienceImpact: 'critical' | 'significant' | 'moderate' | 'minimal';
  /** Likelihood of regression in production */
  regressionRisk: 'high' | 'medium' | 'low';
  /** Recommended priority for fixing */
  fixPriority: number; // 1-10, 10 being highest
  /** Factors contributing to the assessment */
  factors: string[];
}

export interface DetectionMetrics {
  durationMs: number;
  occurrences: number;
  impactScore: number;
  /** Confidence in the scoring accuracy */
  confidence?: ConfidenceLevel;
  /** Estimated speedup percentage if fixed */
  estimatedSpeedupPct?: number;
  /** Explanation of the speedup estimate */
  speedupExplanation?: string;
  /** Percentage of frame budget consumed */
  frameBudgetImpactPct?: number;
  /** Risk assessment for the issue */
  riskAssessment?: RiskAssessment;
}

export interface Detection {
  type: DetectionType;
  severity: Severity;
  description: string;
  location: DetectionLocation;
  metrics: DetectionMetrics;
  evidence: TraceEvent[];
}

export interface DOMPropertyAccess {
  property: string;
  timestamp: number;
  type: 'read' | 'write';
}

export interface ReadWritePattern {
  frameId: number;
  reads: DOMPropertyAccess[];
  writes: DOMPropertyAccess[];
  forcedReflows: number;
}

export interface LayoutThrashDetection extends Detection {
  type: 'layout_thrashing';
  selector: string;
  reflowCostMs: number;
  occurrences: number;
  affectedNodes: number;
  readWritePattern: ReadWritePattern[];
}

export interface LayerInfo {
  layerId: number;
  bounds: { x: number; y: number; width: number; height: number };
  compositingReasons: string[];
}

export interface GPUStallDetection extends Detection {
  type: 'gpu_stall';
  element: string;
  stallMs: number;
  occurrences: number;
  stallType: 'sync' | 'texture_upload' | 'raster';
  layerInfo?: LayerInfo;
}

export interface StackFrame {
  functionName: string;
  file: string;
  line: number;
  column: number;
  isSourceMapped: boolean;
}

export interface LongTaskDetection extends Detection {
  type: 'long_task';
  functionName: string;
  file: string;
  line: number;
  column: number;
  cpuMs: number;
  occurrences: number;
  correlatedFrameDrops: number;
  callStack: StackFrame[];
}

export interface HeavyPaintDetection extends Detection {
  type: 'heavy_paint';
  paintTimeMs: number;
  rasterTimeMs: number;
  layerCount: number;
}
