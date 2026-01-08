/**
 * Suggester interfaces for fix recommendation generation
 */

import type { Detection, DetectionType } from '../../shared/types/index.js';
import type { Suggestion } from '../../shared/types/suggestion.types.js';

/**
 * Interface for individual suggesters that handle specific detection types
 */
export interface ISuggester {
  /** Unique name of the suggester */
  readonly name: string;
  /** Detection types this suggester can handle */
  readonly supportedTypes: DetectionType[];
  /** Generate a suggestion for a detection, returns null if no suggestion applicable */
  suggest(detection: Detection): Promise<Suggestion | null>;
}

/**
 * Interface for the main suggester service that orchestrates all suggesters
 */
export interface ISuggesterService {
  /** Generate suggestions for all detections */
  suggest(detections: Detection[]): Promise<Suggestion[]>;
  /** Get all registered suggesters */
  getSuggesters(): ISuggester[];
  /** Register a new suggester */
  registerSuggester(suggester: ISuggester): void;
}

/**
 * Options for suggestion generation
 */
export interface SuggestionOptions {
  /** Maximum number of suggestions to return */
  maxSuggestions?: number;
  /** Minimum confidence level for suggestions */
  minConfidence?: 'high' | 'medium' | 'low';
  /** Whether to include warnings in suggestions */
  includeWarnings?: boolean;
}
