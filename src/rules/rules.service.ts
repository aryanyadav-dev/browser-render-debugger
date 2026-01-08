/**
 * Rules Service - Manages performance thresholds and severities
 */

import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import type {
  IRulesService,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  RuleEvaluation,
  MetricsData,
  RulesEvaluationResult,
  Rule,
  RuleSet,
  RuleMetric,
} from './interfaces/rules.interface.js';
import type { Severity } from '../shared/types/detection.types.js';

/** Valid rule metrics */
const VALID_METRICS: RuleMetric[] = [
  'p95_frame_time',
  'dropped_frames_pct',
  'reflow_cost_ms',
  'gpu_stall_ms',
  'long_task_ms',
];

/** Valid severities in order of increasing severity */
const SEVERITY_ORDER: Severity[] = ['info', 'warning', 'high', 'critical'];

@Injectable()
export class RulesService implements IRulesService {
  private loadedRules: RuleSet | null = null;

  /**
   * Load rules from a YAML file
   */
  async loadRules(path: string): Promise<RuleSet> {
    const content = await fs.readFile(path, 'utf-8');
    const rules = yaml.load(content) as RuleSet;
    this.loadedRules = rules;
    return rules;
  }

  /**
   * Validate a rule set structure and values
   */
  validateRules(rules: RuleSet): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate version
    if (!rules.version) {
      errors.push({
        field: 'version',
        message: 'Version field is required',
      });
    } else if (typeof rules.version !== 'string') {
      errors.push({
        field: 'version',
        message: 'Version must be a string',
      });
    }

    // Validate rules array
    if (!rules.rules) {
      errors.push({
        field: 'rules',
        message: 'Rules array is required',
      });
    } else if (!Array.isArray(rules.rules)) {
      errors.push({
        field: 'rules',
        message: 'Rules must be an array',
      });
    } else {
      // Track rule IDs for duplicate detection
      const seenIds = new Set<string>();

      for (let i = 0; i < rules.rules.length; i++) {
        const rule = rules.rules[i];
        if (!rule) continue;

        const ruleErrors = this.validateRule(rule, i);
        errors.push(...ruleErrors.errors);
        warnings.push(...ruleErrors.warnings);

        // Check for duplicate IDs
        if (rule.id) {
          if (seenIds.has(rule.id)) {
            errors.push({
              ruleId: rule.id,
              field: 'id',
              message: `Duplicate rule ID: ${rule.id}`,
            });
          }
          seenIds.add(rule.id);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single rule
   */
  private validateRule(
    rule: Rule,
    index: number,
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const ruleId = rule.id ?? `rules[${index}]`;

    // Required fields
    if (!rule.id) {
      errors.push({
        ruleId,
        field: 'id',
        message: 'Rule ID is required',
      });
    } else if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      errors.push({
        ruleId,
        field: 'id',
        message: 'Rule ID must be a non-empty string',
      });
    }

    if (!rule.name) {
      errors.push({
        ruleId,
        field: 'name',
        message: 'Rule name is required',
      });
    }

    if (!rule.metric) {
      errors.push({
        ruleId,
        field: 'metric',
        message: 'Rule metric is required',
      });
    } else if (!VALID_METRICS.includes(rule.metric)) {
      errors.push({
        ruleId,
        field: 'metric',
        message: `Invalid metric: ${rule.metric}. Valid metrics: ${VALID_METRICS.join(', ')}`,
      });
    }

    // Validate thresholds
    if (!rule.thresholds) {
      errors.push({
        ruleId,
        field: 'thresholds',
        message: 'Rule thresholds are required',
      });
    } else {
      const thresholdErrors = this.validateThresholds(rule.thresholds, ruleId);
      errors.push(...thresholdErrors.errors);
      warnings.push(...thresholdErrors.warnings);
    }

    // Validate severity
    if (!rule.severity) {
      errors.push({
        ruleId,
        field: 'severity',
        message: 'Rule severity is required',
      });
    } else if (!SEVERITY_ORDER.includes(rule.severity)) {
      errors.push({
        ruleId,
        field: 'severity',
        message: `Invalid severity: ${rule.severity}. Valid severities: ${SEVERITY_ORDER.join(', ')}`,
      });
    }

    // Validate enabled field
    if (rule.enabled === undefined) {
      warnings.push({
        ruleId,
        field: 'enabled',
        message: 'Rule enabled field not specified, defaulting to true',
      });
    } else if (typeof rule.enabled !== 'boolean') {
      errors.push({
        ruleId,
        field: 'enabled',
        message: 'Rule enabled must be a boolean',
      });
    }

    // Optional description warning
    if (!rule.description) {
      warnings.push({
        ruleId,
        field: 'description',
        message: 'Rule description is recommended',
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate threshold values
   */
  private validateThresholds(
    thresholds: Rule['thresholds'],
    ruleId: string,
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check that at least one threshold is defined
    const definedThresholds = Object.entries(thresholds).filter(
      ([, value]) => value !== undefined && value !== null,
    );

    if (definedThresholds.length === 0) {
      errors.push({
        ruleId,
        field: 'thresholds',
        message: 'At least one threshold must be defined',
      });
      return { errors, warnings };
    }

    // Validate each threshold value
    for (const [key, value] of Object.entries(thresholds)) {
      if (value !== undefined && value !== null) {
        if (typeof value !== 'number') {
          errors.push({
            ruleId,
            field: `thresholds.${key}`,
            message: `Threshold ${key} must be a number`,
          });
        } else if (value < 0) {
          errors.push({
            ruleId,
            field: `thresholds.${key}`,
            message: `Threshold ${key} must be non-negative`,
          });
        }
      }
    }

    // Validate threshold ordering (info < warning < high < critical)
    const values: { severity: Severity; value: number }[] = [];
    for (const severity of SEVERITY_ORDER) {
      const value = this.getThresholdValue(thresholds, severity);
      if (value !== undefined && value !== null) {
        values.push({ severity, value });
      }
    }

    for (let i = 1; i < values.length; i++) {
      const current = values[i];
      const previous = values[i - 1];
      if (current && previous && current.value <= previous.value) {
        warnings.push({
          ruleId,
          field: 'thresholds',
          message: `Threshold ${current.severity} (${current.value}) should be greater than ${previous.severity} (${previous.value})`,
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Get threshold value by severity
   */
  private getThresholdValue(
    thresholds: Rule['thresholds'],
    severity: Severity,
  ): number | undefined {
    switch (severity) {
      case 'info':
        return thresholds.info;
      case 'warning':
        return thresholds.warning;
      case 'high':
        return thresholds.high;
      case 'critical':
        return thresholds.critical;
      default:
        return undefined;
    }
  }

  /**
   * Evaluate a single rule against a metric value
   */
  evaluateRule(rule: Rule, value: number): RuleEvaluation {
    // If rule is disabled, it never violates
    if (rule.enabled === false) {
      return {
        rule,
        value,
        violated: false,
        triggeredSeverity: null,
        message: `Rule ${rule.name} is disabled`,
      };
    }

    // Find the highest severity threshold that is exceeded
    let triggeredSeverity: Severity | null = null;

    // Check thresholds in order of increasing severity
    for (const severity of SEVERITY_ORDER) {
      const threshold = this.getThresholdValue(rule.thresholds, severity);
      if (threshold !== undefined && threshold !== null && value >= threshold) {
        triggeredSeverity = severity;
      }
    }

    const violated = triggeredSeverity !== null;
    let message: string;

    if (violated && triggeredSeverity) {
      const threshold = this.getThresholdValue(
        rule.thresholds,
        triggeredSeverity,
      );
      message = `${rule.name}: ${value} exceeds ${triggeredSeverity} threshold (${threshold})`;
    } else {
      message = `${rule.name}: ${value} is within acceptable limits`;
    }

    return {
      rule,
      value,
      violated,
      triggeredSeverity,
      message,
    };
  }

  /**
   * Evaluate all rules against provided metrics
   */
  evaluateAllRules(
    rules: RuleSet,
    metrics: MetricsData,
  ): RulesEvaluationResult {
    const evaluations: RuleEvaluation[] = [];
    const violations: RuleEvaluation[] = [];
    let maxSeverity: Severity | null = null;

    for (const rule of rules.rules) {
      const metricValue = metrics[rule.metric];

      // Skip if metric is not provided
      if (metricValue === undefined || metricValue === null) {
        continue;
      }

      const evaluation = this.evaluateRule(rule, metricValue);
      evaluations.push(evaluation);

      if (evaluation.violated) {
        violations.push(evaluation);

        // Track maximum severity
        if (evaluation.triggeredSeverity) {
          if (
            maxSeverity === null ||
            this.compareSeverity(evaluation.triggeredSeverity, maxSeverity) > 0
          ) {
            maxSeverity = evaluation.triggeredSeverity;
          }
        }
      }
    }

    return {
      evaluations,
      violations,
      maxSeverity,
      passed: violations.length === 0,
    };
  }

  /**
   * Compare two severities
   * Returns positive if a > b, negative if a < b, 0 if equal
   */
  compareSeverity(a: Severity, b: Severity): number {
    return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
  }

  /**
   * Check if a severity meets or exceeds a threshold
   */
  severityMeetsThreshold(severity: Severity, threshold: Severity): boolean {
    return this.compareSeverity(severity, threshold) >= 0;
  }

  /**
   * List all rules from the loaded rule set
   */
  listRules(): Rule[] {
    return this.loadedRules?.rules ?? [];
  }

  /**
   * Get the default rule set
   */
  getDefaultRules(): RuleSet {
    return {
      version: '1.0',
      rules: [
        {
          id: 'p95_frame_time',
          name: 'P95 Frame Time',
          description: '95th percentile frame rendering time',
          metric: 'p95_frame_time',
          thresholds: {
            info: 16,
            warning: 25,
            high: 33,
            critical: 50,
          },
          severity: 'high',
          enabled: true,
        },
        {
          id: 'dropped_frames',
          name: 'Dropped Frames Percentage',
          description: 'Percentage of frames that exceeded budget',
          metric: 'dropped_frames_pct',
          thresholds: {
            info: 5,
            warning: 10,
            high: 20,
            critical: 30,
          },
          severity: 'warning',
          enabled: true,
        },
        {
          id: 'reflow_cost',
          name: 'Reflow Cost',
          description: 'Total milliseconds spent in forced reflows',
          metric: 'reflow_cost_ms',
          thresholds: {
            info: 50,
            warning: 100,
            high: 200,
            critical: 500,
          },
          severity: 'high',
          enabled: true,
        },
        {
          id: 'gpu_stall',
          name: 'GPU Stall Duration',
          description: 'Total milliseconds main thread blocked on GPU',
          metric: 'gpu_stall_ms',
          thresholds: {
            info: 20,
            warning: 50,
            high: 100,
            critical: 200,
          },
          severity: 'warning',
          enabled: true,
        },
        {
          id: 'long_task',
          name: 'Long Task Duration',
          description: 'Maximum duration of long tasks (>50ms)',
          metric: 'long_task_ms',
          thresholds: {
            info: 50,
            warning: 100,
            high: 200,
            critical: 500,
          },
          severity: 'high',
          enabled: true,
        },
      ],
    };
  }
}
