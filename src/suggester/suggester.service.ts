/**
 * Suggester Service
 * Orchestrates suggestion generation from registered suggesters
 *
 * Requirements: 3.10
 */

import { Injectable } from '@nestjs/common';
import type { Detection } from '../shared/types/index.js';
import type { Suggestion } from '../shared/types/suggestion.types.js';
import type {
  ISuggester,
  ISuggesterService,
  SuggestionOptions,
} from './interfaces/index.js';

/**
 * Default options for suggestion generation
 */
const DEFAULT_OPTIONS: Required<SuggestionOptions> = {
  maxSuggestions: 10,
  minConfidence: 'low',
  includeWarnings: true,
};

/**
 * Confidence level priority for sorting
 */
const CONFIDENCE_PRIORITY: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

@Injectable()
export class SuggesterService implements ISuggesterService {
  private suggesters: ISuggester[] = [];

  /**
   * Register a suggester for generating suggestions
   */
  registerSuggester(suggester: ISuggester): void {
    // Avoid duplicate registration
    if (!this.suggesters.some((s) => s.name === suggester.name)) {
      this.suggesters.push(suggester);
    }
  }

  /**
   * Get all registered suggesters
   */
  getSuggesters(): ISuggester[] {
    return [...this.suggesters];
  }

  /**
   * Generate suggestions for all detections
   */
  async suggest(
    detections: Detection[],
    options?: SuggestionOptions,
  ): Promise<Suggestion[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const suggestions: Suggestion[] = [];

    // Sort detections by impact score (highest first)
    const sortedDetections = [...detections].sort(
      (a, b) => b.metrics.impactScore - a.metrics.impactScore,
    );

    // Generate suggestions for each detection
    for (const detection of sortedDetections) {
      const detectSuggestions = await this.suggestForDetection(detection);
      suggestions.push(...detectSuggestions);
    }

    // Filter by minimum confidence
    const filteredSuggestions = this.filterByConfidence(
      suggestions,
      opts.minConfidence,
    );

    // Prioritize and limit suggestions
    const prioritizedSuggestions = this.prioritizeSuggestions(
      filteredSuggestions,
      opts.maxSuggestions,
    );

    return prioritizedSuggestions;
  }

  /**
   * Generate suggestions for a single detection
   */
  private async suggestForDetection(
    detection: Detection,
  ): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];

    // Find suggesters that support this detection type
    const applicableSuggesters = this.suggesters.filter((s) =>
      s.supportedTypes.includes(detection.type),
    );

    // Generate suggestions from each applicable suggester
    for (const suggester of applicableSuggesters) {
      try {
        const suggestion = await suggester.suggest(detection);
        if (suggestion) {
          suggestions.push(suggestion);
        }
      } catch (error) {
        // Log error but continue with other suggesters
        console.warn(
          `Suggester ${suggester.name} failed for detection ${detection.type}:`,
          error,
        );
      }
    }

    return suggestions;
  }

  /**
   * Filter suggestions by minimum confidence level
   */
  private filterByConfidence(
    suggestions: Suggestion[],
    minConfidence: 'high' | 'medium' | 'low',
  ): Suggestion[] {
    const minPriority = CONFIDENCE_PRIORITY[minConfidence] ?? 1;

    return suggestions.filter((s) => {
      const priority = CONFIDENCE_PRIORITY[s.confidence] ?? 1;
      return priority >= minPriority;
    });
  }

  /**
   * Prioritize suggestions by impact and confidence
   */
  private prioritizeSuggestions(
    suggestions: Suggestion[],
    maxSuggestions: number,
  ): Suggestion[] {
    // Sort by estimated speedup (descending), then by confidence (descending)
    const sorted = [...suggestions].sort((a, b) => {
      // Primary sort: estimated speedup
      const speedupDiff = b.estimatedSpeedupPct - a.estimatedSpeedupPct;
      if (speedupDiff !== 0) return speedupDiff;

      // Secondary sort: confidence level
      const confA = CONFIDENCE_PRIORITY[a.confidence] ?? 1;
      const confB = CONFIDENCE_PRIORITY[b.confidence] ?? 1;
      return confB - confA;
    });

    // Limit to max suggestions
    return sorted.slice(0, maxSuggestions);
  }

  /**
   * Generate a unique suggestion ID
   */
  static generateSuggestionId(): string {
    return `suggestion-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
