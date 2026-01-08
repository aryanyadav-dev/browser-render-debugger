/**
 * Rules module interfaces for performance threshold management
 */

import type {
  Rule,
  RuleSet,
  RuleMetric,
  RuleThresholds,
} from '../../shared/types/config.types.js';
import type { Severity } from '../../shared/types/detection.types.js';

/**
 * Result of rule validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  ruleId?: string;
  field: string;
  message: string;
}

export interface ValidationWarning {
  ruleId?: string;
  field: string;
  message: string;
}

/**
 * Result of evaluating a rule against a metric value
 */
export interface RuleEvaluation {
  rule: Rule;
  value: number;
  violated: boolean;
  triggeredSeverity: Severity | null;
  message: string;
}

/**
 * Metrics that can be evaluated against rules
 */
export interface MetricsData {
  p95_frame_time?: number;
  dropped_frames_pct?: number;
  reflow_cost_ms?: number;
  gpu_stall_ms?: number;
  long_task_ms?: number;
}

/**
 * Result of evaluating all rules against metrics
 */
export interface RulesEvaluationResult {
  evaluations: RuleEvaluation[];
  violations: RuleEvaluation[];
  maxSeverity: Severity | null;
  passed: boolean;
}

/**
 * Rules service interface
 */
export interface IRulesService {
  /**
   * Load rules from a file path
   */
  loadRules(path: string): Promise<RuleSet>;

  /**
   * Validate a rule set structure and values
   */
  validateRules(rules: RuleSet): ValidationResult;

  /**
   * Evaluate a single rule against a metric value
   */
  evaluateRule(rule: Rule, value: number): RuleEvaluation;

  /**
   * Evaluate all rules against provided metrics
   */
  evaluateAllRules(rules: RuleSet, metrics: MetricsData): RulesEvaluationResult;

  /**
   * List all rules from the loaded rule set
   */
  listRules(): Rule[];

  /**
   * Get the default rule set
   */
  getDefaultRules(): RuleSet;
}

// Re-export types for convenience
export type { Rule, RuleSet, RuleMetric, RuleThresholds };
export type { Severity };
