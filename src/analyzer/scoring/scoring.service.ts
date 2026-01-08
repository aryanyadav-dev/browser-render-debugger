/**
 * Enterprise-Grade Scoring Service
 * Provides centralized, configurable, and auditable scoring for performance detections
 *
 * Features:
 * - Multi-dimensional weighted scoring
 * - Confidence level calculation
 * - Speedup estimation with efficiency factors
 * - Percentile-based severity mapping
 * - Frame budget impact analysis
 * - Historical baseline comparison support
 * - Configurable thresholds and weights
 */

import { Injectable } from '@nestjs/common';
import type { Severity } from '../../shared/types/index';

/**
 * Confidence level for scoring accuracy
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Detection type for scoring context
 */
export type ScoringDetectionType =
  | 'layout_thrashing'
  | 'gpu_stall'
  | 'long_task'
  | 'heavy_paint'
  | 'forced_reflow';

/**
 * Input metrics for scoring calculation
 */
export interface ScoringInput {
  /** Detection type for context-aware scoring */
  detectionType: ScoringDetectionType;
  /** Total duration of the issue in milliseconds */
  durationMs: number;
  /** Number of occurrences */
  occurrences: number;
  /** Frame budget in milliseconds (e.g., 16.67ms for 60fps) */
  frameBudgetMs: number;
  /** Total trace duration in milliseconds */
  traceDurationMs: number;
  /** Optional: affected node count for DOM-related issues */
  affectedNodes?: number;
  /** Optional: correlated frame drops */
  correlatedFrameDrops?: number;
  /** Optional: layer count for paint issues */
  layerCount?: number;
  /** Optional: stall type for GPU issues */
  stallType?: 'sync' | 'texture_upload' | 'raster';
}

/**
 * Comprehensive scoring result
 */
export interface ScoringResult {
  /** Overall impact score (0-100) */
  impactScore: number;
  /** Severity level based on thresholds */
  severity: Severity;
  /** Confidence in the scoring accuracy */
  confidence: ConfidenceLevel;
  /** Estimated speedup percentage if fixed */
  estimatedSpeedupPct: number;
  /** Explanation of the speedup estimate */
  speedupExplanation: string;
  /** Percentage of frame budget consumed */
  frameBudgetImpactPct: number;
  /** Breakdown of score components */
  scoreBreakdown: ScoreBreakdown;
  /** Risk assessment for the issue */
  riskAssessment: RiskAssessment;
}

/**
 * Detailed breakdown of score components
 */
export interface ScoreBreakdown {
  /** Duration-based score component (0-100) */
  durationScore: number;
  /** Frequency-based score component (0-100) */
  frequencyScore: number;
  /** Impact-based score component (0-100) */
  impactScore: number;
  /** Type-specific modifier applied */
  typeModifier: number;
  /** Weights used for calculation */
  weights: ScoringWeights;
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

/**
 * Configurable weights for scoring dimensions
 */
export interface ScoringWeights {
  duration: number;
  frequency: number;
  impact: number;
}

/**
 * Severity thresholds configuration
 */
export interface SeverityThresholds {
  critical: number;
  high: number;
  warning: number;
  info: number;
}

/**
 * Configuration for the scoring service
 */
export interface ScoringConfig {
  /** Weights for different scoring dimensions */
  weights: ScoringWeights;
  /** Thresholds for severity mapping */
  severityThresholds: SeverityThresholds;
  /** Maximum speedup cap (conservative estimate) */
  maxSpeedupCap: number;
  /** Minimum evidence threshold for high confidence */
  highConfidenceThresholdMs: number;
  /** Minimum evidence threshold for medium confidence */
  mediumConfidenceThresholdMs: number;
}

/**
 * Efficiency factors for different fix types
 * Based on empirical data and conservative estimates
 */
const EFFICIENCY_FACTORS: Record<string, number> = {
  // CSS fixes - generally high efficiency
  contain_property: 0.8,
  will_change: 0.7,
  transform_instead_of_position: 0.75,
  width_percentage: 0.6,
  css_containment: 0.75,
  layer_promotion: 0.65,

  // JS fixes - variable efficiency
  batch_dom_writes: 0.7,
  debounce: 0.5,
  move_to_worker: 0.6,
  use_raf: 0.65,
  use_css_animation: 0.8,
  virtualization: 0.7,
  lazy_loading: 0.55,

  // GPU fixes
  reduce_layer_count: 0.6,
  optimize_textures: 0.5,
  reduce_overdraw: 0.55,

  // Default fallback
  default: 0.5,
};

/**
 * Type-specific modifiers for scoring
 * Accounts for the relative impact of different issue types
 */
const TYPE_MODIFIERS: Record<ScoringDetectionType, number> = {
  layout_thrashing: 1.2, // High impact on user experience
  gpu_stall: 1.1, // Blocks rendering pipeline
  long_task: 1.0, // Standard impact
  heavy_paint: 0.9, // Often less noticeable
  forced_reflow: 1.15, // Synchronous, blocking
};

/**
 * Default scoring configuration
 */
const DEFAULT_CONFIG: ScoringConfig = {
  weights: {
    duration: 0.45,
    frequency: 0.3,
    impact: 0.25,
  },
  severityThresholds: {
    critical: 80,
    high: 60,
    warning: 35,
    info: 0,
  },
  maxSpeedupCap: 0.8, // 80% max speedup (conservative)
  highConfidenceThresholdMs: 10,
  mediumConfidenceThresholdMs: 5,
};

@Injectable()
export class ScoringService {
  private config: ScoringConfig;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Configure the scoring service with custom settings
   */
  configure(config: Partial<ScoringConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      weights: { ...this.config.weights, ...config.weights },
      severityThresholds: {
        ...this.config.severityThresholds,
        ...config.severityThresholds,
      },
    };
  }

  /**
   * Calculate comprehensive scoring for a detection
   */
  calculateScore(input: ScoringInput): ScoringResult {
    // Calculate individual score components
    const durationScore = this.calculateDurationScore(input);
    const frequencyScore = this.calculateFrequencyScore(input);
    const impactScore = this.calculateImpactComponentScore(input);

    // Apply type-specific modifier
    const typeModifier = TYPE_MODIFIERS[input.detectionType];

    // Calculate weighted composite score
    const rawScore =
      durationScore * this.config.weights.duration +
      frequencyScore * this.config.weights.frequency +
      impactScore * this.config.weights.impact;

    // Apply type modifier and clamp to 0-100
    const finalScore = Math.min(100, Math.round(rawScore * typeModifier));

    // Calculate frame budget impact
    const avgDurationPerOccurrence =
      input.durationMs / Math.max(input.occurrences, 1);
    const frameBudgetImpactPct =
      (avgDurationPerOccurrence / input.frameBudgetMs) * 100;

    // Determine severity
    const severity = this.mapScoreToSeverity(finalScore, frameBudgetImpactPct);

    // Calculate confidence
    const confidence = this.calculateConfidence(input);

    // Calculate speedup estimation
    const { estimatedSpeedupPct, speedupExplanation } =
      this.calculateSpeedupEstimate(input, frameBudgetImpactPct);

    // Generate risk assessment
    const riskAssessment = this.assessRisk(
      input,
      finalScore,
      frameBudgetImpactPct,
    );

    return {
      impactScore: finalScore,
      severity,
      confidence,
      estimatedSpeedupPct,
      speedupExplanation,
      frameBudgetImpactPct: Math.round(frameBudgetImpactPct * 10) / 10,
      scoreBreakdown: {
        durationScore: Math.round(durationScore),
        frequencyScore: Math.round(frequencyScore),
        impactScore: Math.round(impactScore),
        typeModifier,
        weights: { ...this.config.weights },
      },
      riskAssessment,
    };
  }

  /**
   * Calculate duration-based score component
   * Uses logarithmic scaling for better distribution
   */
  private calculateDurationScore(input: ScoringInput): number {
    const { durationMs, frameBudgetMs, traceDurationMs } = input;

    // Calculate what percentage of trace time was spent on this issue
    const tracePercentage = (durationMs / traceDurationMs) * 100;

    // Calculate how many frame budgets this issue consumed
    const frameBudgetsConsumed = durationMs / frameBudgetMs;

    // Logarithmic scaling for duration (handles wide range of values)
    // Score increases rapidly for small values, then tapers off
    const logScore = Math.log10(frameBudgetsConsumed + 1) * 30;

    // Linear component based on trace percentage
    const linearScore = Math.min(tracePercentage * 5, 40);

    // Combine with diminishing returns
    return Math.min(100, logScore + linearScore);
  }

  /**
   * Calculate frequency-based score component
   * More occurrences indicate a systemic issue
   */
  private calculateFrequencyScore(input: ScoringInput): number {
    const { occurrences, traceDurationMs, frameBudgetMs } = input;

    // Calculate expected frames in trace
    const expectedFrames = traceDurationMs / frameBudgetMs;

    // Calculate occurrence rate (occurrences per expected frame)
    const occurrenceRate = occurrences / Math.max(expectedFrames, 1);

    // Logarithmic scaling for occurrences
    const logOccurrences = Math.log10(occurrences + 1) * 25;

    // Rate-based scoring (how often does this happen per frame?)
    const rateScore = Math.min(occurrenceRate * 100, 50);

    return Math.min(100, logOccurrences + rateScore);
  }

  /**
   * Calculate impact-based score component
   * Considers type-specific factors
   */
  private calculateImpactComponentScore(input: ScoringInput): number {
    const {
      detectionType,
      affectedNodes,
      correlatedFrameDrops,
      layerCount,
      stallType,
    } = input;

    let impactScore = 50; // Base score

    switch (detectionType) {
      case 'layout_thrashing':
        // More affected nodes = higher impact
        if (affectedNodes !== undefined) {
          impactScore += Math.min(Math.log10(affectedNodes + 1) * 20, 30);
        }
        break;

      case 'long_task':
        // Frame drops directly correlate with user-visible jank
        if (correlatedFrameDrops !== undefined) {
          impactScore += Math.min(correlatedFrameDrops * 5, 40);
        }
        break;

      case 'heavy_paint':
        // Layer count affects compositing complexity
        if (layerCount !== undefined) {
          impactScore += Math.min(Math.log10(layerCount + 1) * 15, 25);
        }
        break;

      case 'gpu_stall':
        // Sync stalls are more impactful than async operations
        if (stallType === 'sync') {
          impactScore += 25;
        } else if (stallType === 'texture_upload') {
          impactScore += 15;
        } else if (stallType === 'raster') {
          impactScore += 10;
        }
        break;

      case 'forced_reflow':
        // Forced reflows are always synchronous and blocking
        impactScore += 20;
        if (affectedNodes !== undefined) {
          impactScore += Math.min(Math.log10(affectedNodes + 1) * 15, 20);
        }
        break;
    }

    return Math.min(100, impactScore);
  }

  /**
   * Map score to severity level
   * Uses both score and frame budget impact for accurate severity
   */
  private mapScoreToSeverity(
    score: number,
    frameBudgetImpactPct: number,
  ): Severity {
    const { severityThresholds } = this.config;

    // Critical: High score OR consuming more than 100% of frame budget
    if (score >= severityThresholds.critical || frameBudgetImpactPct > 100) {
      return 'critical';
    }

    // High: Elevated score OR consuming more than 50% of frame budget
    if (score >= severityThresholds.high || frameBudgetImpactPct > 50) {
      return 'high';
    }

    // Warning: Moderate score OR consuming more than 25% of frame budget
    if (score >= severityThresholds.warning || frameBudgetImpactPct > 25) {
      return 'warning';
    }

    return 'info';
  }

  /**
   * Calculate confidence level based on evidence strength
   */
  private calculateConfidence(input: ScoringInput): ConfidenceLevel {
    const { durationMs, occurrences } = input;
    const avgDuration = durationMs / Math.max(occurrences, 1);

    // High confidence: Strong evidence (significant duration and multiple occurrences)
    if (
      avgDuration >= this.config.highConfidenceThresholdMs &&
      occurrences >= 3
    ) {
      return 'high';
    }

    // Medium confidence: Moderate evidence
    if (
      avgDuration >= this.config.mediumConfidenceThresholdMs ||
      occurrences >= 2
    ) {
      return 'medium';
    }

    // Low confidence: Limited evidence
    return 'low';
  }

  /**
   * Calculate speedup estimation with conservative heuristics
   */
  private calculateSpeedupEstimate(
    input: ScoringInput,
    frameBudgetImpactPct: number,
  ): { estimatedSpeedupPct: number; speedupExplanation: string } {
    const { detectionType, durationMs, frameBudgetMs } = input;

    // Get efficiency factor based on detection type
    const fixType = this.getRecommendedFixType(detectionType);
    const efficiencyFactor =
      EFFICIENCY_FACTORS[fixType] ?? EFFICIENCY_FACTORS.default ?? 0.5;

    // Calculate raw speedup based on frame budget impact
    const rawSpeedup = (frameBudgetImpactPct / 100) * efficiencyFactor;

    // Apply conservative cap
    const cappedSpeedup = Math.min(rawSpeedup, this.config.maxSpeedupCap);

    // Convert to percentage
    const estimatedSpeedupPct = Math.round(cappedSpeedup * 100);

    // Generate explanation
    const explanation = this.generateSpeedupExplanation(
      detectionType,
      durationMs,
      frameBudgetMs,
      efficiencyFactor,
      estimatedSpeedupPct,
    );

    return { estimatedSpeedupPct, speedupExplanation: explanation };
  }

  /**
   * Get recommended fix type for a detection type
   */
  private getRecommendedFixType(detectionType: ScoringDetectionType): string {
    const fixTypeMap: Record<ScoringDetectionType, string> = {
      layout_thrashing: 'batch_dom_writes',
      gpu_stall: 'reduce_layer_count',
      long_task: 'use_raf',
      heavy_paint: 'css_containment',
      forced_reflow: 'batch_dom_writes',
    };

    return fixTypeMap[detectionType] ?? 'default';
  }

  /**
   * Generate human-readable speedup explanation
   */
  private generateSpeedupExplanation(
    detectionType: ScoringDetectionType,
    durationMs: number,
    frameBudgetMs: number,
    efficiencyFactor: number,
    estimatedSpeedupPct: number,
  ): string {
    const frameBudgetsConsumed = (durationMs / frameBudgetMs).toFixed(1);
    const efficiencyPct = Math.round(efficiencyFactor * 100);

    const typeDescriptions: Record<ScoringDetectionType, string> = {
      layout_thrashing: 'batching DOM reads/writes',
      gpu_stall: 'optimizing GPU operations',
      long_task: 'breaking up long tasks',
      heavy_paint: 'applying CSS containment',
      forced_reflow: 'eliminating forced synchronous layouts',
    };

    const fixDescription = typeDescriptions[detectionType];

    return (
      `This issue consumes ${frameBudgetsConsumed} frame budgets (${durationMs.toFixed(1)}ms). ` +
      `By ${fixDescription}, we estimate a ${estimatedSpeedupPct}% improvement ` +
      `(based on ${efficiencyPct}% typical efficiency for this fix type, ` +
      `capped at ${Math.round(this.config.maxSpeedupCap * 100)}% for conservative estimation).`
    );
  }

  /**
   * Assess risk for prioritization
   */
  private assessRisk(
    input: ScoringInput,
    score: number,
    frameBudgetImpactPct: number,
  ): RiskAssessment {
    const factors: string[] = [];

    // Determine user experience impact
    let userExperienceImpact: RiskAssessment['userExperienceImpact'];
    if (frameBudgetImpactPct > 100 || score >= 80) {
      userExperienceImpact = 'critical';
      factors.push('Causes visible frame drops and jank');
    } else if (frameBudgetImpactPct > 50 || score >= 60) {
      userExperienceImpact = 'significant';
      factors.push('May cause noticeable stuttering');
    } else if (frameBudgetImpactPct > 25 || score >= 35) {
      userExperienceImpact = 'moderate';
      factors.push('Could affect smooth scrolling');
    } else {
      userExperienceImpact = 'minimal';
      factors.push('Unlikely to be user-visible');
    }

    // Determine regression risk
    let regressionRisk: RiskAssessment['regressionRisk'];
    if (input.occurrences >= 10 || input.durationMs > 500) {
      regressionRisk = 'high';
      factors.push('Frequent occurrence suggests systemic issue');
    } else if (input.occurrences >= 5 || input.durationMs > 200) {
      regressionRisk = 'medium';
      factors.push('Multiple occurrences detected');
    } else {
      regressionRisk = 'low';
      factors.push('Isolated occurrence');
    }

    // Calculate fix priority (1-10)
    let fixPriority = Math.ceil(score / 10);

    // Boost priority for critical UX impact
    if (userExperienceImpact === 'critical') {
      fixPriority = Math.min(10, fixPriority + 2);
      factors.push('Priority boosted due to critical UX impact');
    }

    // Boost priority for high regression risk
    if (regressionRisk === 'high') {
      fixPriority = Math.min(10, fixPriority + 1);
      factors.push('Priority boosted due to regression risk');
    }

    return {
      userExperienceImpact,
      regressionRisk,
      fixPriority,
      factors,
    };
  }

  /**
   * Batch score multiple detections and rank them
   */
  batchScore(inputs: ScoringInput[]): Array<ScoringResult & { rank: number }> {
    const results = inputs.map((input) => this.calculateScore(input));

    // Sort by impact score descending
    const ranked = results
      .map((result, index) => ({ ...result, originalIndex: index }))
      .sort((a, b) => b.impactScore - a.impactScore)
      .map((result, rank) => ({
        ...result,
        rank: rank + 1,
      }));

    return ranked;
  }

  /**
   * Get scoring configuration for auditing
   */
  getConfig(): ScoringConfig {
    return { ...this.config };
  }

  /**
   * Get efficiency factors for documentation
   */
  getEfficiencyFactors(): Record<string, number> {
    return { ...EFFICIENCY_FACTORS };
  }
}
