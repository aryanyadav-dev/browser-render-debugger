/**
 * SpeedupCalculator Service
 * Provides conservative speedup estimation with efficiency factors
 *
 * Requirements: 10.14, 10.15
 */

import { Injectable } from '@nestjs/common';
import type {
  SpeedupCalculation,
  SuggestionConfidence,
  JSFixPattern,
} from '../shared/types/suggestion.types.js';
import type { DetectionType } from '../shared/types/detection.types.js';

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
 * Maximum speedup cap (80% as per requirements)
 */
const MAX_SPEEDUP_CAP = 0.8;

/**
 * Confidence thresholds
 */
const HIGH_CONFIDENCE_THRESHOLD_MS = 10;
const MEDIUM_CONFIDENCE_THRESHOLD_MS = 5;

@Injectable()
export class SpeedupCalculatorService {
  /**
   * Calculate speedup estimation for a fix
   *
   * Formula: speedup = (issue_time / total_frame_time) * efficiency_factor
   * Capped at 80% for conservative estimation
   */
  calculateSpeedup(
    issueTimeMs: number,
    totalFrameTimeMs: number,
    fixType: string,
  ): SpeedupCalculation {
    const efficiencyFactor = this.getEfficiencyFactor(fixType);

    // Calculate raw speedup based on issue time relative to frame time
    const rawSpeedup = (issueTimeMs / totalFrameTimeMs) * efficiencyFactor;

    // Apply conservative cap at 80%
    const cappedSpeedup = Math.min(rawSpeedup, MAX_SPEEDUP_CAP);

    // Determine confidence based on evidence strength
    const confidence = this.calculateConfidence(issueTimeMs);

    return {
      issueTimeMs,
      totalFrameTimeMs,
      efficiencyFactor,
      speedupPct: Math.round(cappedSpeedup * 100),
      confidence,
    };
  }

  /**
   * Generate human-readable explanation of the speedup estimate
   */
  generateExplanation(
    calculation: SpeedupCalculation,
    fixType: string,
    detectionType: DetectionType,
  ): string {
    const { issueTimeMs, totalFrameTimeMs, efficiencyFactor, speedupPct } =
      calculation;

    const frameBudgetsConsumed = (issueTimeMs / totalFrameTimeMs).toFixed(1);
    const efficiencyPct = Math.round(efficiencyFactor * 100);

    const typeDescriptions: Record<DetectionType, string> = {
      layout_thrashing: 'batching DOM reads/writes',
      gpu_stall: 'optimizing GPU operations',
      long_task: 'breaking up long tasks',
      heavy_paint: 'applying CSS containment',
      forced_reflow: 'eliminating forced synchronous layouts',
    };

    const fixDescription =
      typeDescriptions[detectionType] ?? 'applying the suggested fix';

    return (
      `This issue consumes ${frameBudgetsConsumed} frame budgets (${issueTimeMs.toFixed(1)}ms). ` +
      `By ${fixDescription}, we estimate a ${speedupPct}% improvement ` +
      `(based on ${efficiencyPct}% typical efficiency for ${fixType} fixes, ` +
      `capped at ${Math.round(MAX_SPEEDUP_CAP * 100)}% for conservative estimation).`
    );
  }

  /**
   * Get efficiency factor for a fix type
   */
  getEfficiencyFactor(fixType: string): number {
    return EFFICIENCY_FACTORS[fixType] ?? EFFICIENCY_FACTORS.default ?? 0.5;
  }

  /**
   * Get recommended fix type for a detection type
   */
  getRecommendedFixType(detectionType: DetectionType): string {
    const fixTypeMap: Record<DetectionType, string> = {
      layout_thrashing: 'batch_dom_writes',
      gpu_stall: 'reduce_layer_count',
      long_task: 'use_raf',
      heavy_paint: 'css_containment',
      forced_reflow: 'batch_dom_writes',
    };

    return fixTypeMap[detectionType] ?? 'default';
  }

  /**
   * Get recommended JS fix pattern for a detection type
   */
  getRecommendedJSPattern(detectionType: DetectionType): JSFixPattern {
    const patternMap: Record<DetectionType, JSFixPattern> = {
      layout_thrashing: 'batch_dom_writes',
      gpu_stall: 'use_css_animation',
      long_task: 'use_raf',
      heavy_paint: 'use_css_animation',
      forced_reflow: 'batch_dom_writes',
    };

    return patternMap[detectionType] ?? 'use_raf';
  }

  /**
   * Calculate confidence level based on evidence strength
   */
  private calculateConfidence(issueTimeMs: number): SuggestionConfidence {
    if (issueTimeMs >= HIGH_CONFIDENCE_THRESHOLD_MS) {
      return 'high';
    }
    if (issueTimeMs >= MEDIUM_CONFIDENCE_THRESHOLD_MS) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Get all available efficiency factors for documentation
   */
  getEfficiencyFactors(): Record<string, number> {
    return { ...EFFICIENCY_FACTORS };
  }

  /**
   * Get the maximum speedup cap
   */
  getMaxSpeedupCap(): number {
    return MAX_SPEEDUP_CAP;
  }
}
