/**
 * Compare module interfaces
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import type { TraceSummary, Severity } from '../../shared/types/index.js';

/**
 * Metric change direction
 */
export type ChangeDirection = 'regression' | 'improvement' | 'unchanged';

/**
 * Individual metric comparison result
 */
export interface MetricComparison {
  /** Name of the metric */
  name: string;
  /** Base value (from baseline trace) */
  baseValue: number;
  /** Head value (from comparison trace) */
  headValue: number;
  /** Absolute change (head - base) */
  absoluteChange: number;
  /** Percentage change ((head - base) / base * 100) */
  percentageChange: number;
  /** Direction of change */
  direction: ChangeDirection;
  /** Severity of the change */
  severity: Severity;
  /** Unit of measurement */
  unit: string;
}

/**
 * Hotspot comparison for layout thrashing
 */
export interface LayoutThrashComparison {
  selector: string;
  baseReflowCostMs: number;
  headReflowCostMs: number;
  direction: ChangeDirection;
  percentageChange: number;
}

/**
 * Hotspot comparison for GPU stalls
 */
export interface GPUStallComparison {
  element: string;
  baseStallMs: number;
  headStallMs: number;
  direction: ChangeDirection;
  percentageChange: number;
}

/**
 * Hotspot comparison for long tasks
 */
export interface LongTaskComparison {
  function: string;
  file: string;
  baseCpuMs: number;
  headCpuMs: number;
  direction: ChangeDirection;
  percentageChange: number;
}

/**
 * Hotspot comparisons grouped by type
 */
export interface HotspotComparisons {
  layoutThrashing: LayoutThrashComparison[];
  gpuStalls: GPUStallComparison[];
  longTasks: LongTaskComparison[];
}

/**
 * Complete comparison result
 */
export interface ComparisonResult {
  /** Unique ID for this comparison */
  id: string;
  /** Base trace summary */
  baseSummary: TraceSummary;
  /** Head trace summary */
  headSummary: TraceSummary;
  /** Frame metric comparisons */
  frameMetrics: MetricComparison[];
  /** Phase breakdown comparisons */
  phaseBreakdown: MetricComparison[];
  /** Hotspot comparisons */
  hotspots: HotspotComparisons;
  /** All regressions found */
  regressions: MetricComparison[];
  /** All improvements found */
  improvements: MetricComparison[];
  /** Overall change impact score (0-100) */
  changeImpactScore: number;
  /** Highest severity among regressions */
  maxRegressionSeverity: Severity | null;
  /** Timestamp of comparison */
  timestamp: string;
}

/**
 * Options for trace comparison
 */
export interface CompareOptions {
  /** Threshold for considering a change significant (percentage) */
  significanceThreshold?: number;
  /** Custom severity thresholds */
  severityThresholds?: SeverityThresholds;
}

/**
 * Severity thresholds for metric changes
 */
export interface SeverityThresholds {
  /** Percentage change for info level */
  info: number;
  /** Percentage change for warning level */
  warning: number;
  /** Percentage change for high level */
  high: number;
  /** Percentage change for critical level */
  critical: number;
}

/**
 * Compare service interface
 */
export interface ICompareService {
  /**
   * Compare two trace summaries
   */
  compare(
    baseSummary: TraceSummary,
    headSummary: TraceSummary,
    options?: CompareOptions,
  ): ComparisonResult;

  /**
   * Calculate change impact score
   */
  calculateChangeImpactScore(
    regressions: MetricComparison[],
    improvements: MetricComparison[],
  ): number;

  /**
   * Determine severity based on percentage change
   */
  determineSeverity(
    percentageChange: number,
    thresholds?: SeverityThresholds,
  ): Severity;
}
