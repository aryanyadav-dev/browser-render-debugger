import { Injectable } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import type { Config, RuleSet } from '../shared/types/index.js';

export interface ConfigValidationError {
  field: string;
  message: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

@Injectable()
export class ConfigService {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Generate default configuration
   */
  getDefaultConfig(browserPath: string): Config {
    return {
      version: '1.0',
      browser: {
        path: browserPath,
        defaultHeadless: true,
        defaultCdpPort: 9222,
        launchTimeout: 30000,
      },
      profiling: {
        defaultDuration: 15,
        defaultFpsTarget: 60,
        traceCategories: [
          'devtools.timeline',
          'blink.user_timing',
          'gpu',
          'v8.execute',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
        ],
        bufferSize: 100000,
      },
      analysis: {
        longTaskThreshold: 50,
        layoutThrashThreshold: 5,
        gpuStallThreshold: 20,
        maxSuggestions: 10,
      },
      output: {
        tracesDir: '.render-debugger/traces',
        reportsDir: '.render-debugger/reports',
        patchesDir: '.render-debugger/patches',
      },
    };
  }

  /**
   * Generate default rules
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
          description: 'JavaScript tasks blocking main thread over 50ms',
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

  /**
   * Load configuration from file or return null if not found
   */
  async loadConfig(): Promise<Config | null> {
    return this.storageService.readConfig();
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config: Config): Promise<void> {
    await this.storageService.writeConfig(config);
  }

  /**
   * Load rules from file or return null if not found
   */
  async loadRules(): Promise<RuleSet | null> {
    return this.storageService.readRules();
  }

  /**
   * Save rules to file
   */
  async saveRules(rules: RuleSet): Promise<void> {
    await this.storageService.writeRules(rules);
  }

  /**
   * Validate configuration
   */
  validateConfig(config: Config): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];

    if (!config.version) {
      errors.push({ field: 'version', message: 'Version is required' });
    }

    if (!config.browser) {
      errors.push({
        field: 'browser',
        message: 'Browser configuration is required',
      });
    } else {
      if (!config.browser.path) {
        errors.push({
          field: 'browser.path',
          message: 'Browser path is required',
        });
      }
      if (
        typeof config.browser.defaultCdpPort !== 'number' ||
        config.browser.defaultCdpPort < 1
      ) {
        errors.push({
          field: 'browser.defaultCdpPort',
          message: 'CDP port must be a positive number',
        });
      }
      if (
        typeof config.browser.launchTimeout !== 'number' ||
        config.browser.launchTimeout < 0
      ) {
        errors.push({
          field: 'browser.launchTimeout',
          message: 'Launch timeout must be a non-negative number',
        });
      }
    }

    if (!config.profiling) {
      errors.push({
        field: 'profiling',
        message: 'Profiling configuration is required',
      });
    } else {
      if (
        typeof config.profiling.defaultDuration !== 'number' ||
        config.profiling.defaultDuration < 1
      ) {
        errors.push({
          field: 'profiling.defaultDuration',
          message: 'Default duration must be at least 1 second',
        });
      }
      if (
        typeof config.profiling.defaultFpsTarget !== 'number' ||
        config.profiling.defaultFpsTarget < 1
      ) {
        errors.push({
          field: 'profiling.defaultFpsTarget',
          message: 'FPS target must be at least 1',
        });
      }
      if (
        !Array.isArray(config.profiling.traceCategories) ||
        config.profiling.traceCategories.length === 0
      ) {
        errors.push({
          field: 'profiling.traceCategories',
          message: 'At least one trace category is required',
        });
      }
    }

    if (!config.analysis) {
      errors.push({
        field: 'analysis',
        message: 'Analysis configuration is required',
      });
    } else {
      if (
        typeof config.analysis.longTaskThreshold !== 'number' ||
        config.analysis.longTaskThreshold < 0
      ) {
        errors.push({
          field: 'analysis.longTaskThreshold',
          message: 'Long task threshold must be non-negative',
        });
      }
      if (
        typeof config.analysis.maxSuggestions !== 'number' ||
        config.analysis.maxSuggestions < 1
      ) {
        errors.push({
          field: 'analysis.maxSuggestions',
          message: 'Max suggestions must be at least 1',
        });
      }
    }

    if (!config.output) {
      errors.push({
        field: 'output',
        message: 'Output configuration is required',
      });
    } else {
      if (!config.output.tracesDir) {
        errors.push({
          field: 'output.tracesDir',
          message: 'Traces directory is required',
        });
      }
      if (!config.output.reportsDir) {
        errors.push({
          field: 'output.reportsDir',
          message: 'Reports directory is required',
        });
      }
      if (!config.output.patchesDir) {
        errors.push({
          field: 'output.patchesDir',
          message: 'Patches directory is required',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate rules
   */
  validateRules(rules: RuleSet): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];

    if (!rules.version) {
      errors.push({ field: 'version', message: 'Version is required' });
    }

    if (!Array.isArray(rules.rules)) {
      errors.push({ field: 'rules', message: 'Rules must be an array' });
      return { valid: false, errors };
    }

    const validMetrics = [
      'p95_frame_time',
      'dropped_frames_pct',
      'reflow_cost_ms',
      'gpu_stall_ms',
      'long_task_ms',
    ];
    const validSeverities = ['info', 'warning', 'high', 'critical'];

    rules.rules.forEach((rule, index) => {
      const prefix = `rules[${index}]`;

      if (!rule.id) {
        errors.push({ field: `${prefix}.id`, message: 'Rule ID is required' });
      }
      if (!rule.name) {
        errors.push({
          field: `${prefix}.name`,
          message: 'Rule name is required',
        });
      }
      if (!rule.metric || !validMetrics.includes(rule.metric)) {
        errors.push({
          field: `${prefix}.metric`,
          message: `Metric must be one of: ${validMetrics.join(', ')}`,
        });
      }
      if (!rule.severity || !validSeverities.includes(rule.severity)) {
        errors.push({
          field: `${prefix}.severity`,
          message: `Severity must be one of: ${validSeverities.join(', ')}`,
        });
      }
      if (!rule.thresholds || typeof rule.thresholds !== 'object') {
        errors.push({
          field: `${prefix}.thresholds`,
          message: 'Thresholds are required',
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
