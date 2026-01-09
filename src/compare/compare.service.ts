/**
 * Compare Service
 * Compares two trace summaries to identify regressions and improvements
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import { Injectable } from '@nestjs/common';
import type { TraceSummary, Severity } from '../shared/types/index.js';
import type {
  ICompareService,
  CompareOptions,
  ComparisonResult,
  MetricComparison,
  ChangeDirection,
  SeverityThresholds,
  HotspotComparisons,
  LayoutThrashComparison,
  GPUStallComparison,
  LongTaskComparison,
} from './interfaces/index.js';

/**
 * Default severity thresholds (percentage change)
 */
const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  info: 5, // 5% change
  warning: 15, // 15% change
  high: 30, // 30% change
  critical: 50, // 50% change
};

/**
 * Default significance threshold (percentage)
 */
const DEFAULT_SIGNIFICANCE_THRESHOLD = 2;

@Injectable()
export class CompareService implements ICompareService {
  /**
   * Compare two trace summaries and produce a comparison result
   */
  compare(
    baseSummary: TraceSummary,
    headSummary: TraceSummary,
    options: CompareOptions = {},
  ): ComparisonResult {
    const significanceThreshold =
      options.significanceThreshold ?? DEFAULT_SIGNIFICANCE_THRESHOLD;
    const severityThresholds =
      options.severityThresholds ?? DEFAULT_SEVERITY_THRESHOLDS;

    // Compare frame metrics
    const frameMetrics = this.compareFrameMetrics(
      baseSummary,
      headSummary,
      severityThresholds,
    );

    // Compare phase breakdown
    const phaseBreakdown = this.comparePhaseBreakdown(
      baseSummary,
      headSummary,
      severityThresholds,
    );

    // Compare hotspots
    const hotspots = this.compareHotspots(baseSummary, headSummary);

    // Collect all metric comparisons
    const allMetrics = [...frameMetrics, ...phaseBreakdown];

    // Filter regressions and improvements based on significance threshold
    const regressions = allMetrics.filter(
      (m) =>
        m.direction === 'regression' &&
        Math.abs(m.percentageChange) >= significanceThreshold,
    );

    const improvements = allMetrics.filter(
      (m) =>
        m.direction === 'improvement' &&
        Math.abs(m.percentageChange) >= significanceThreshold,
    );

    // Calculate change impact score
    const changeImpactScore = this.calculateChangeImpactScore(
      regressions,
      improvements,
    );

    // Determine max regression severity
    const maxRegressionSeverity = this.getMaxSeverity(regressions);

    return {
      id: this.generateComparisonId(),
      baseSummary,
      headSummary,
      frameMetrics,
      phaseBreakdown,
      hotspots,
      regressions,
      improvements,
      changeImpactScore,
      maxRegressionSeverity,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Compare frame metrics between two summaries
   */
  private compareFrameMetrics(
    base: TraceSummary,
    head: TraceSummary,
    thresholds: SeverityThresholds,
  ): MetricComparison[] {
    const metrics: MetricComparison[] = [];

    // Total frames (higher is better)
    metrics.push(
      this.createMetricComparison(
        'Total Frames',
        base.frames.total,
        head.frames.total,
        'frames',
        thresholds,
        true, // higher is better
      ),
    );

    // Dropped frames (lower is better)
    metrics.push(
      this.createMetricComparison(
        'Dropped Frames',
        base.frames.dropped,
        head.frames.dropped,
        'frames',
        thresholds,
        false, // lower is better
      ),
    );

    // Average FPS (higher is better)
    metrics.push(
      this.createMetricComparison(
        'Average FPS',
        base.frames.avg_fps,
        head.frames.avg_fps,
        'fps',
        thresholds,
        true, // higher is better
      ),
    );

    // Dropped frames percentage (calculated)
    const baseDroppedPct =
      base.frames.total > 0
        ? (base.frames.dropped / base.frames.total) * 100
        : 0;
    const headDroppedPct =
      head.frames.total > 0
        ? (head.frames.dropped / head.frames.total) * 100
        : 0;
    metrics.push(
      this.createMetricComparison(
        'Dropped Frames %',
        baseDroppedPct,
        headDroppedPct,
        '%',
        thresholds,
        false, // lower is better
      ),
    );

    return metrics;
  }

  /**
   * Compare phase breakdown between two summaries
   */
  private comparePhaseBreakdown(
    base: TraceSummary,
    head: TraceSummary,
    thresholds: SeverityThresholds,
  ): MetricComparison[] {
    const metrics: MetricComparison[] = [];

    // Style recalc (lower is better)
    metrics.push(
      this.createMetricComparison(
        'Style Recalc',
        base.phase_breakdown.style_recalc_ms,
        head.phase_breakdown.style_recalc_ms,
        'ms',
        thresholds,
        false,
      ),
    );

    // Layout (lower is better)
    metrics.push(
      this.createMetricComparison(
        'Layout',
        base.phase_breakdown.layout_ms,
        head.phase_breakdown.layout_ms,
        'ms',
        thresholds,
        false,
      ),
    );

    // Paint (lower is better)
    metrics.push(
      this.createMetricComparison(
        'Paint',
        base.phase_breakdown.paint_ms,
        head.phase_breakdown.paint_ms,
        'ms',
        thresholds,
        false,
      ),
    );

    // Composite (lower is better)
    metrics.push(
      this.createMetricComparison(
        'Composite',
        base.phase_breakdown.composite_ms,
        head.phase_breakdown.composite_ms,
        'ms',
        thresholds,
        false,
      ),
    );

    // GPU (lower is better)
    metrics.push(
      this.createMetricComparison(
        'GPU',
        base.phase_breakdown.gpu_ms,
        head.phase_breakdown.gpu_ms,
        'ms',
        thresholds,
        false,
      ),
    );

    return metrics;
  }

  /**
   * Compare hotspots between two summaries
   */
  private compareHotspots(
    base: TraceSummary,
    head: TraceSummary,
  ): HotspotComparisons {
    return {
      layoutThrashing: this.compareLayoutThrashing(base, head),
      gpuStalls: this.compareGPUStalls(base, head),
      longTasks: this.compareLongTasks(base, head),
    };
  }

  /**
   * Compare layout thrashing hotspots
   */
  private compareLayoutThrashing(
    base: TraceSummary,
    head: TraceSummary,
  ): LayoutThrashComparison[] {
    const comparisons: LayoutThrashComparison[] = [];
    const baseMap = new Map(
      base.hotspots.layout_thrashing.map((h) => [h.selector, h]),
    );
    const headMap = new Map(
      head.hotspots.layout_thrashing.map((h) => [h.selector, h]),
    );

    // Compare existing hotspots
    for (const [selector, baseHotspot] of baseMap) {
      const headHotspot = headMap.get(selector);
      if (headHotspot) {
        const percentageChange = this.calculatePercentageChange(
          baseHotspot.reflow_cost_ms,
          headHotspot.reflow_cost_ms,
        );
        comparisons.push({
          selector,
          baseReflowCostMs: baseHotspot.reflow_cost_ms,
          headReflowCostMs: headHotspot.reflow_cost_ms,
          direction: this.determineDirection(percentageChange, false),
          percentageChange,
        });
      } else {
        // Hotspot removed (improvement)
        comparisons.push({
          selector,
          baseReflowCostMs: baseHotspot.reflow_cost_ms,
          headReflowCostMs: 0,
          direction: 'improvement',
          percentageChange: -100,
        });
      }
    }

    // New hotspots in head (regression)
    for (const [selector, headHotspot] of headMap) {
      if (!baseMap.has(selector)) {
        comparisons.push({
          selector,
          baseReflowCostMs: 0,
          headReflowCostMs: headHotspot.reflow_cost_ms,
          direction: 'regression',
          percentageChange: 100,
        });
      }
    }

    return comparisons;
  }

  /**
   * Compare GPU stall hotspots
   */
  private compareGPUStalls(
    base: TraceSummary,
    head: TraceSummary,
  ): GPUStallComparison[] {
    const comparisons: GPUStallComparison[] = [];
    const baseMap = new Map(
      base.hotspots.gpu_stalls.map((h) => [h.element, h]),
    );
    const headMap = new Map(
      head.hotspots.gpu_stalls.map((h) => [h.element, h]),
    );

    for (const [element, baseHotspot] of baseMap) {
      const headHotspot = headMap.get(element);
      if (headHotspot) {
        const percentageChange = this.calculatePercentageChange(
          baseHotspot.stall_ms,
          headHotspot.stall_ms,
        );
        comparisons.push({
          element,
          baseStallMs: baseHotspot.stall_ms,
          headStallMs: headHotspot.stall_ms,
          direction: this.determineDirection(percentageChange, false),
          percentageChange,
        });
      } else {
        comparisons.push({
          element,
          baseStallMs: baseHotspot.stall_ms,
          headStallMs: 0,
          direction: 'improvement',
          percentageChange: -100,
        });
      }
    }

    for (const [element, headHotspot] of headMap) {
      if (!baseMap.has(element)) {
        comparisons.push({
          element,
          baseStallMs: 0,
          headStallMs: headHotspot.stall_ms,
          direction: 'regression',
          percentageChange: 100,
        });
      }
    }

    return comparisons;
  }

  /**
   * Compare long task hotspots
   */
  private compareLongTasks(
    base: TraceSummary,
    head: TraceSummary,
  ): LongTaskComparison[] {
    const comparisons: LongTaskComparison[] = [];

    // Create key from function + file
    const createKey = (h: { function: string; file: string }) =>
      `${h.function}@${h.file}`;

    const baseMap = new Map(
      base.hotspots.long_tasks.map((h) => [createKey(h), h]),
    );
    const headMap = new Map(
      head.hotspots.long_tasks.map((h) => [createKey(h), h]),
    );

    for (const [key, baseHotspot] of baseMap) {
      const headHotspot = headMap.get(key);
      if (headHotspot) {
        const percentageChange = this.calculatePercentageChange(
          baseHotspot.cpu_ms,
          headHotspot.cpu_ms,
        );
        comparisons.push({
          function: baseHotspot.function,
          file: baseHotspot.file,
          baseCpuMs: baseHotspot.cpu_ms,
          headCpuMs: headHotspot.cpu_ms,
          direction: this.determineDirection(percentageChange, false),
          percentageChange,
        });
      } else {
        comparisons.push({
          function: baseHotspot.function,
          file: baseHotspot.file,
          baseCpuMs: baseHotspot.cpu_ms,
          headCpuMs: 0,
          direction: 'improvement',
          percentageChange: -100,
        });
      }
    }

    for (const [key, headHotspot] of headMap) {
      if (!baseMap.has(key)) {
        comparisons.push({
          function: headHotspot.function,
          file: headHotspot.file,
          baseCpuMs: 0,
          headCpuMs: headHotspot.cpu_ms,
          direction: 'regression',
          percentageChange: 100,
        });
      }
    }

    return comparisons;
  }

  /**
   * Create a metric comparison object
   */
  private createMetricComparison(
    name: string,
    baseValue: number,
    headValue: number,
    unit: string,
    thresholds: SeverityThresholds,
    higherIsBetter: boolean,
  ): MetricComparison {
    const absoluteChange = headValue - baseValue;
    const percentageChange = this.calculatePercentageChange(
      baseValue,
      headValue,
    );
    const direction = this.determineDirection(percentageChange, higherIsBetter);
    const severity = this.determineSeverity(
      Math.abs(percentageChange),
      thresholds,
    );

    return {
      name,
      baseValue: Math.round(baseValue * 100) / 100,
      headValue: Math.round(headValue * 100) / 100,
      absoluteChange: Math.round(absoluteChange * 100) / 100,
      percentageChange: Math.round(percentageChange * 100) / 100,
      direction,
      severity: direction === 'regression' ? severity : 'info',
      unit,
    };
  }

  /**
   * Calculate percentage change between two values
   */
  private calculatePercentageChange(
    baseValue: number,
    headValue: number,
  ): number {
    if (baseValue === 0) {
      return headValue === 0 ? 0 : 100;
    }
    return ((headValue - baseValue) / Math.abs(baseValue)) * 100;
  }

  /**
   * Determine change direction based on percentage change and metric type
   */
  private determineDirection(
    percentageChange: number,
    higherIsBetter: boolean,
  ): ChangeDirection {
    if (Math.abs(percentageChange) < 0.01) {
      return 'unchanged';
    }

    if (higherIsBetter) {
      return percentageChange > 0 ? 'improvement' : 'regression';
    } else {
      return percentageChange < 0 ? 'improvement' : 'regression';
    }
  }

  /**
   * Determine severity based on percentage change
   */
  determineSeverity(
    percentageChange: number,
    thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
  ): Severity {
    const absChange = Math.abs(percentageChange);

    if (absChange >= thresholds.critical) {
      return 'critical';
    }
    if (absChange >= thresholds.high) {
      return 'high';
    }
    if (absChange >= thresholds.warning) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Calculate change impact score (0-100)
   *
   * The score represents the overall impact of changes:
   * - 0: No significant changes
   * - 1-40: Minor improvements or regressions
   * - 41-70: Moderate improvements or regressions
   * - 71-100: Major improvements or severe regressions
   *
   * Positive score = improvements, Negative score = regressions
   * We return absolute value with context from improvements/regressions arrays
   */
  calculateChangeImpactScore(
    regressions: MetricComparison[],
    improvements: MetricComparison[],
  ): number {
    if (regressions.length === 0 && improvements.length === 0) {
      return 0;
    }

    // Weight by severity
    const severityWeights: Record<Severity, number> = {
      info: 1,
      warning: 2,
      high: 4,
      critical: 8,
    };

    // Calculate weighted regression score
    let regressionScore = 0;
    for (const regression of regressions) {
      const weight = severityWeights[regression.severity];
      const impact = Math.min(Math.abs(regression.percentageChange), 100);
      regressionScore += weight * impact;
    }

    // Calculate weighted improvement score (treat improvements as positive impact)
    let improvementScore = 0;
    for (const improvement of improvements) {
      // Weight improvements by their magnitude
      const impact = Math.min(Math.abs(improvement.percentageChange), 100);
      // Give more weight to critical metrics (FPS, dropped frames)
      const weight = improvement.name.toLowerCase().includes('fps') || 
                     improvement.name.toLowerCase().includes('dropped') ? 2 : 1;
      improvementScore += weight * impact;
    }

    // If only improvements, return positive impact score
    if (regressions.length === 0 && improvements.length > 0) {
      // Calculate average improvement impact
      const avgImprovement = improvementScore / improvements.length;
      // Scale to 0-100, with major improvements (>50% change) scoring high
      const score = Math.min(100, Math.round(avgImprovement * 0.8));
      return Math.max(1, score); // Minimum 1 if there are improvements
    }

    // If only regressions, return negative impact (but we show absolute value)
    if (improvements.length === 0 && regressions.length > 0) {
      const maxPossibleRegression = regressions.length * 8 * 100;
      const normalizedRegression =
        maxPossibleRegression > 0
          ? (regressionScore / maxPossibleRegression) * 100
          : 0;
      return Math.round(normalizedRegression);
    }

    // Mixed: calculate net impact
    const maxPossibleRegression = regressions.length * 8 * 100;
    const maxPossibleImprovement = improvements.length * 100;

    const normalizedRegression =
      maxPossibleRegression > 0
        ? (regressionScore / maxPossibleRegression) * 100
        : 0;
    const normalizedImprovement =
      maxPossibleImprovement > 0
        ? (improvementScore / maxPossibleImprovement) * 100
        : 0;

    // Net score: improvements reduce regression impact
    let score = normalizedRegression - normalizedImprovement * 0.5;

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    return Math.round(score);
  }

  /**
   * Get the maximum severity from a list of metric comparisons
   */
  private getMaxSeverity(metrics: MetricComparison[]): Severity | null {
    if (metrics.length === 0) {
      return null;
    }

    const severityOrder: Severity[] = ['info', 'warning', 'high', 'critical'];
    let maxIndex = -1;

    for (const metric of metrics) {
      const index = severityOrder.indexOf(metric.severity);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    if (maxIndex >= 0 && maxIndex < severityOrder.length) {
      return severityOrder[maxIndex] as Severity;
    }
    return null;
  }

  /**
   * Generate unique comparison ID
   */
  private generateComparisonId(): string {
    return `compare-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
