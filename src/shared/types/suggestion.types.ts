/**
 * Suggestion types for fix recommendations
 */

export type JSFixPattern =
  | 'batch_dom_writes'
  | 'debounce'
  | 'move_to_worker'
  | 'use_raf'
  | 'use_css_animation';

export type SuggestionConfidence = 'high' | 'medium' | 'low';

/**
 * Source type for suggestions - determines if auto-patching is available
 */
export type SuggestionSource = 'js' | 'css' | 'native' | 'unknown';

/**
 * Fix target type - determines what kind of fix can be applied
 */
export type FixTargetType = 'auto-patchable' | 'suggestion-only';

export interface Suggestion {
  id: string;
  type: 'css' | 'js' | 'native';
  target: string;
  description: string;
  patch: string;
  estimatedSpeedupPct: number;
  speedupExplanation: string;
  confidence: SuggestionConfidence;
  warnings: string[];
  affectedFiles: string[];
  /**
   * Source of the issue - determines if auto-patching is available
   * - 'js' | 'css': Web resources that can be auto-patched
   * - 'native': Swift/native code that cannot be auto-patched
   * - 'unknown': Source not determined
   */
  source?: SuggestionSource;
  /**
   * Whether this suggestion can be auto-patched
   * - 'auto-patchable': Can be applied automatically via patch
   * - 'suggestion-only': Human-readable suggestion only (native code)
   */
  fixTargetType?: FixTargetType;
  /**
   * Documentation links for manual fixes (especially for native suggestions)
   */
  documentationLinks?: string[];
}

export interface CSSSuggestion extends Suggestion {
  type: 'css';
  originalRule: string;
  suggestedRule: string;
  property: string;
  memoryImpact: 'none' | 'low' | 'medium' | 'high';
  tradeoffs: string[];
}

export interface JSSuggestion extends Suggestion {
  type: 'js';
  pattern: JSFixPattern;
  codeSnippet: string;
  suggestedCode: string;
}

/**
 * Native suggestion for Swift/native code issues
 * These are human-readable suggestions only - no auto-patching
 */
export interface NativeSuggestion extends Omit<Suggestion, 'type' | 'patch'> {
  /** Native suggestions don't have a type in the traditional sense */
  type: 'native';
  /** Native suggestions don't have patches - only human-readable guidance */
  patch: '';
  /** The native platform (swift, objc, etc.) */
  platform: 'swift' | 'objc' | 'native';
  /** Human-readable fix guidance */
  fixGuidance: string;
  /** Code example showing the recommended pattern */
  codeExample?: string;
  /** Links to Apple/platform documentation */
  documentationLinks: string[];
  /** Related Apple frameworks */
  relatedFrameworks?: string[];
  /** Always suggestion-only for native */
  fixTargetType: 'suggestion-only';
  /** Always native source */
  source: 'native';
}

export interface SpeedupCalculation {
  issueTimeMs: number;
  totalFrameTimeMs: number;
  efficiencyFactor: number;
  speedupPct: number;
  confidence: SuggestionConfidence;
}
