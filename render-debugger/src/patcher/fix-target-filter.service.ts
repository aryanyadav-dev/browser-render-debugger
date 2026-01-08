/**
 * Fix Target Filter Service
 *
 * Filters suggestions based on whether they can be auto-patched.
 * Auto-patching applies ONLY to JS/CSS resources.
 * Native Swift code is NOT auto-modified - only suggestions are provided.
 *
 * Requirements: 15.22
 */

import { Injectable } from '@nestjs/common';
import type {
  Suggestion,
  SuggestionSource,
  FixTargetType,
  NativeSuggestion,
} from '../shared/types/suggestion.types.js';

/**
 * Result of filtering suggestions by fix target
 */
export interface FilteredSuggestions {
  /** Suggestions that can be auto-patched (JS/CSS) */
  patchable: Suggestion[];
  /** Suggestions that are human-readable only (native) */
  suggestionOnly: (Suggestion | NativeSuggestion)[];
  /** All suggestions with fix target type annotated */
  all: Suggestion[];
}

/**
 * File patterns for identifying source types
 */
const SOURCE_PATTERNS = {
  js: [/\.js$/, /\.ts$/, /\.jsx$/, /\.tsx$/, /\.mjs$/, /\.cjs$/],
  css: [/\.css$/, /\.scss$/, /\.sass$/, /\.less$/, /\.styl$/],
  native: [/\.swift$/, /\.m$/, /\.mm$/, /\.h$/, /\.cpp$/, /\.c$/],
};

@Injectable()
export class FixTargetFilterService {
  /**
   * Filter suggestions into patchable and suggestion-only categories
   *
   * @param suggestions - Array of suggestions to filter
   * @returns Filtered suggestions categorized by fix target type
   */
  filterSuggestions(suggestions: Suggestion[]): FilteredSuggestions {
    const annotated = suggestions.map((s) => this.annotateSuggestion(s));

    const patchable = annotated.filter(
      (s) => s.fixTargetType === 'auto-patchable',
    );

    const suggestionOnly = annotated.filter(
      (s) => s.fixTargetType === 'suggestion-only',
    );

    return {
      patchable,
      suggestionOnly,
      all: annotated,
    };
  }

  /**
   * Annotate a suggestion with source and fix target type
   */
  annotateSuggestion(suggestion: Suggestion): Suggestion {
    // If already annotated, return as-is
    if (suggestion.source && suggestion.fixTargetType) {
      return suggestion;
    }

    const source = this.determineSource(suggestion);
    const fixTargetType = this.determineFixTargetType(source);

    return {
      ...suggestion,
      source,
      fixTargetType,
    };
  }

  /**
   * Determine the source type of a suggestion based on affected files
   */
  determineSource(suggestion: Suggestion): SuggestionSource {
    // If source is already set, use it
    if (suggestion.source) {
      return suggestion.source;
    }

    // Check affected files to determine source
    const files = suggestion.affectedFiles || [];

    // Check for native files first (highest priority for filtering)
    if (files.some((f) => this.matchesPatterns(f, SOURCE_PATTERNS.native))) {
      return 'native';
    }

    // Check for JS files
    if (files.some((f) => this.matchesPatterns(f, SOURCE_PATTERNS.js))) {
      return 'js';
    }

    // Check for CSS files
    if (files.some((f) => this.matchesPatterns(f, SOURCE_PATTERNS.css))) {
      return 'css';
    }

    // Fallback to suggestion type
    if (suggestion.type === 'js') {
      return 'js';
    }
    if (suggestion.type === 'css') {
      return 'css';
    }

    return 'unknown';
  }

  /**
   * Determine fix target type based on source
   */
  determineFixTargetType(source: SuggestionSource): FixTargetType {
    // Only JS and CSS can be auto-patched
    if (source === 'js' || source === 'css') {
      return 'auto-patchable';
    }

    // Native and unknown sources are suggestion-only
    return 'suggestion-only';
  }

  /**
   * Check if a file path matches any of the given patterns
   */
  private matchesPatterns(filePath: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * Check if a suggestion is patchable (can be auto-applied)
   */
  isPatchable(suggestion: Suggestion): boolean {
    const annotated = this.annotateSuggestion(suggestion);
    return annotated.fixTargetType === 'auto-patchable';
  }

  /**
   * Check if a suggestion is for native code
   */
  isNative(suggestion: Suggestion): boolean {
    const source = this.determineSource(suggestion);
    return source === 'native';
  }

  /**
   * Get only patchable suggestions from a list
   */
  getPatchableSuggestions(suggestions: Suggestion[]): Suggestion[] {
    return this.filterSuggestions(suggestions).patchable;
  }

  /**
   * Get only suggestion-only items from a list
   */
  getSuggestionOnlyItems(
    suggestions: Suggestion[],
  ): (Suggestion | NativeSuggestion)[] {
    return this.filterSuggestions(suggestions).suggestionOnly;
  }
}
