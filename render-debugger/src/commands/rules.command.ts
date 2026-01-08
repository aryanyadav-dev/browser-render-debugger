/**
 * Rules Commands
 * Manages performance rules - list and validate
 *
 * Requirements: 7.1, 7.2
 */

import { Command, CommandRunner, SubCommand, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { RulesService } from '../rules/rules.service.js';
import { StorageService } from '../services/storage.service.js';
import { RuleValidationError } from '../errors/error-types.js';
import type { Rule, RuleSet } from '../rules/interfaces/rules.interface.js';

interface RulesListOptions {
  json?: boolean;
  enabled?: boolean;
  metric?: string;
}

interface RulesValidateOptions {
  file?: string;
  strict?: boolean;
}

/**
 * Rules List Subcommand
 * Displays all configured rules
 */
@Injectable()
@SubCommand({
  name: 'list',
  description: 'Display all configured performance rules',
})
export class RulesListCommand extends CommandRunner {
  constructor(
    private readonly rulesService: RulesService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async run(_passedParams: string[], options: RulesListOptions): Promise<void> {
    try {
      // Load rules from default location
      const rulesPath = path.join(
        this.storageService.getBaseDir(),
        'rules.yaml',
      );

      let rules: RuleSet;
      try {
        rules = await this.rulesService.loadRules(rulesPath);
      } catch {
        // If no rules file exists, use defaults
        console.log('Warning: No rules.yaml found, showing default rules\n');
        rules = this.rulesService.getDefaultRules();
      }

      // Filter rules if options provided
      let filteredRules = rules.rules;

      if (options.enabled !== undefined) {
        filteredRules = filteredRules.filter(
          (r) => r.enabled === options.enabled,
        );
      }

      if (options.metric) {
        filteredRules = filteredRules.filter(
          (r) => r.metric === options.metric,
        );
      }

      // Output format
      if (options.json) {
        console.log(
          JSON.stringify(
            { version: rules.version, rules: filteredRules },
            null,
            2,
          ),
        );
      } else {
        this.displayRulesTable(rules.version, filteredRules);
      }

      process.exit(0);
    } catch (error) {
      console.error('Error: Failed to list rules');
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      }
      process.exit(1);
    }
  }

  /**
   * Display rules in a formatted table
   */
  private displayRulesTable(version: string, rules: Rule[]): void {
    console.log('Performance Rules\n');
    console.log(`  Version: ${version}`);
    console.log(`  Total: ${rules.length} rule(s)\n`);

    if (rules.length === 0) {
      console.log('  No rules found matching the criteria.\n');
      return;
    }

    console.log('-'.repeat(80));
    console.log(
      `${'ID'.padEnd(20)} ${'Name'.padEnd(25)} ${'Metric'.padEnd(20)} ${'Status'.padEnd(10)}`,
    );
    console.log('-'.repeat(80));

    for (const rule of rules) {
      const status = rule.enabled ? 'Enabled' : 'Disabled';
      console.log(
        `${rule.id.padEnd(20)} ${rule.name.padEnd(25)} ${rule.metric.padEnd(20)} ${status}`,
      );
    }

    console.log('-'.repeat(80));
    console.log('');

    // Show detailed view
    console.log('Rule Details:\n');

    for (const rule of rules) {
      this.displayRuleDetails(rule);
    }
  }

  /**
   * Display detailed information for a single rule
   */
  private displayRuleDetails(rule: Rule): void {
    const status = rule.enabled ? '[Enabled]' : '[Disabled]';
    console.log(`${status} ${rule.name} (${rule.id})`);
    console.log(`  Metric: ${rule.metric}`);
    console.log(`  Severity: ${rule.severity}`);

    if (rule.description) {
      console.log(`  Description: ${rule.description}`);
    }

    console.log('  Thresholds:');
    if (rule.thresholds.info !== undefined) {
      console.log(`    info: ${rule.thresholds.info}`);
    }
    if (rule.thresholds.warning !== undefined) {
      console.log(`    warning: ${rule.thresholds.warning}`);
    }
    if (rule.thresholds.high !== undefined) {
      console.log(`    high: ${rule.thresholds.high}`);
    }
    if (rule.thresholds.critical !== undefined) {
      console.log(`    critical: ${rule.thresholds.critical}`);
    }

    console.log('');
  }

  @Option({
    flags: '-j, --json',
    description: 'Output rules in JSON format',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }

  @Option({
    flags: '-e, --enabled <enabled>',
    description: 'Filter by enabled status (true/false)',
  })
  parseEnabled(val: string): boolean {
    return val === 'true';
  }

  @Option({
    flags: '-m, --metric <metric>',
    description: 'Filter by metric type',
  })
  parseMetric(val: string): string {
    return val;
  }
}

/**
 * Rules Validate Subcommand
 * Validates the rules.yaml file structure
 */
@Injectable()
@SubCommand({
  name: 'validate',
  description: 'Validate the rules.yaml file structure',
})
export class RulesValidateCommand extends CommandRunner {
  constructor(
    private readonly rulesService: RulesService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async run(
    _passedParams: string[],
    options: RulesValidateOptions,
  ): Promise<void> {
    try {
      // Determine rules file path
      const rulesPath =
        options.file ??
        path.join(this.storageService.getBaseDir(), 'rules.yaml');

      console.log(`Validating rules file: ${rulesPath}\n`);

      // Load rules
      let rules: RuleSet;
      try {
        rules = await this.rulesService.loadRules(rulesPath);
      } catch (error) {
        console.error('Error: Failed to load rules file');
        if (error instanceof Error) {
          console.error(`  ${error.message}`);
        }
        process.exit(40);
      }

      // Validate rules
      const result = this.rulesService.validateRules(rules);

      // Display results
      if (result.errors.length > 0) {
        console.log('Validation Errors:\n');
        for (const error of result.errors) {
          const rulePrefix = error.ruleId ? `[${error.ruleId}] ` : '';
          console.log(`  ERROR: ${rulePrefix}${error.field}: ${error.message}`);
        }
        console.log('');
      }

      if (result.warnings.length > 0) {
        console.log('Validation Warnings:\n');
        for (const warning of result.warnings) {
          const rulePrefix = warning.ruleId ? `[${warning.ruleId}] ` : '';
          console.log(
            `  WARN: ${rulePrefix}${warning.field}: ${warning.message}`,
          );
        }
        console.log('');
      }

      // Summary
      if (result.valid) {
        console.log('Rules file is valid.\n');
        console.log(`  Version: ${rules.version}`);
        console.log(`  Rules: ${rules.rules.length}`);
        console.log(
          `  Enabled: ${rules.rules.filter((r) => r.enabled !== false).length}`,
        );
        console.log(
          `  Disabled: ${rules.rules.filter((r) => r.enabled === false).length}`,
        );

        if (result.warnings.length > 0) {
          console.log(`\n  ${result.warnings.length} warning(s) found`);
        }

        // In strict mode, warnings are treated as errors
        if (options.strict && result.warnings.length > 0) {
          console.log('\nError: Strict mode - warnings are treated as errors');
          process.exit(40);
        }

        process.exit(0);
      } else {
        console.log(
          `Rules file is invalid: ${result.errors.length} error(s) found\n`,
        );
        throw new RuleValidationError(
          rulesPath,
          result.errors.map((e) => e.message),
        );
      }
    } catch (error) {
      if (error instanceof RuleValidationError) {
        process.exit(error.exitCode);
      }

      console.error('Error: Validation failed');
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      }
      process.exit(1);
    }
  }

  @Option({
    flags: '-f, --file <path>',
    description:
      'Path to rules.yaml file (default: .render-debugger/rules.yaml)',
  })
  parseFile(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --strict',
    description: 'Treat warnings as errors',
    defaultValue: false,
  })
  parseStrict(): boolean {
    return true;
  }
}

/**
 * Rules Parent Command
 * Groups rules subcommands
 */
@Injectable()
@Command({
  name: 'rules',
  description: 'Manage performance rules',
  subCommands: [RulesListCommand, RulesValidateCommand],
})
export class RulesCommand extends CommandRunner {
  run(): Promise<void> {
    // This is called when no subcommand is provided
    console.log('Rules Management\n');
    console.log('Available subcommands:');
    console.log('  list      Display all configured performance rules');
    console.log('  validate  Validate the rules.yaml file structure');
    console.log(
      '\nRun `render-debugger rules <subcommand> --help` for more information.\n',
    );
    return Promise.resolve();
  }
}
