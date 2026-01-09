/**
 * Compare Command
 * Compares two trace summaries to identify regressions and improvements
 *
 * Requirements: 4.4, 4.5, 4.6
 */

import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import { CompareService } from '../compare/compare.service.js';
import { StorageService } from '../services/storage.service.js';
import {
  TraceParseError,
  TraceNotFoundError,
  RegressionDetectedError,
} from '../errors/error-types.js';
import type { TraceSummary, Severity } from '../shared/types/index.js';
import type {
  ComparisonResult,
  MetricComparison,
} from '../compare/interfaces/index.js';

interface CompareCommandOptions {
  json?: boolean;
  failOn?: Severity;
  verbose?: boolean;
  noColor?: boolean;
  latest?: boolean;
}

@Injectable()
@Command({
  name: 'compare',
  aliases: ['c'],
  description:
    'Compare two trace summaries to identify regressions and improvements',
  arguments: '<base-trace> [head-trace]',
})
export class CompareCommand extends CommandRunner {
  constructor(
    private readonly compareService: CompareService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async run(
    passedParams: string[],
    options: CompareCommandOptions,
  ): Promise<void> {
    let [baseTracePath, headTracePath] = passedParams;

    if (!baseTracePath) {
      console.error('● Error: Base trace path is required');
      console.error('Usage: render-debugger compare <base-trace> [head-trace]');
      console.error('       render-debugger compare <base-trace> --latest');
      process.exit(1);
    }

    // Auto-detect latest trace for head if --latest or no head specified
    if (options.latest || !headTracePath) {
      console.log('> Searching for latest trace to compare against...');
      const latestTrace = await this.storageService.findLatestTrace();
      
      if (!latestTrace) {
        console.error('● Error: No trace files found for comparison');
        console.error('   Run `render-debugger profile --url <URL>` first to create a trace');
        process.exit(1);
      }
      
      headTracePath = latestTrace;
      console.log(`> Found: ${headTracePath}\n`);
    }

    try {
      // Load trace summaries
      const baseSummary = await this.loadTraceSummary(baseTracePath);
      const headSummary = await this.loadTraceSummary(headTracePath);

      // Perform comparison
      const result = this.compareService.compare(baseSummary, headSummary);

      // Output results
      if (options.json) {
        this.outputJson(result);
      } else {
        this.outputTerminal(result, options);
      }

      // Check fail-on threshold
      if (options.failOn) {
        this.checkFailOnThreshold(result, options.failOn);
      }

      process.exit(0);
    } catch (error) {
      this.handleError(error, baseTracePath, headTracePath);
    }
  }

  /**
   * Load trace summary from file path
   * Supports both trace.json and trace-summary.json files
   */
  private async loadTraceSummary(tracePath: string): Promise<TraceSummary> {
    // Check if file exists
    const exists = await this.storageService.exists(tracePath);
    if (!exists) {
      throw new TraceNotFoundError(tracePath);
    }

    try {
      const content = await fs.readFile(tracePath, 'utf-8');
      const data: unknown = JSON.parse(content);

      // If it's a trace-summary.json, return directly
      if (this.isTraceSummary(data)) {
        return data as TraceSummary;
      }

      // If it's a trace.json, look for accompanying summary
      const summaryPath = tracePath.replace('trace.json', 'trace-summary.json');
      if (tracePath !== summaryPath) {
        const summaryExists = await this.storageService.exists(summaryPath);
        if (summaryExists) {
          const summaryContent = await fs.readFile(summaryPath, 'utf-8');
          return JSON.parse(summaryContent) as TraceSummary;
        }
      }

      throw new TraceParseError(
        tracePath,
        new Error(
          'File is not a valid trace summary. Use trace-summary.json files for comparison.',
        ),
      );
    } catch (error) {
      if (
        error instanceof TraceParseError ||
        error instanceof TraceNotFoundError
      ) {
        throw error;
      }
      throw new TraceParseError(
        tracePath,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Check if data is a TraceSummary
   */
  private isTraceSummary(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    const obj = data as Record<string, unknown>;
    return (
      'id' in obj &&
      'name' in obj &&
      'frames' in obj &&
      'phase_breakdown' in obj &&
      'hotspots' in obj
    );
  }

  /**
   * Output comparison result as JSON
   */
  private outputJson(result: ComparisonResult): void {
    console.log(JSON.stringify(result, null, 2));
  }

  /**
   * Output comparison result to terminal
   */
  private outputTerminal(
    result: ComparisonResult,
    options: CompareCommandOptions,
  ): void {
    const useColor = !options.noColor;
    const verbose = options.verbose;

    console.log('\nTrace Comparison Report\n');
    console.log('═'.repeat(60));

    // Summary
    console.log('\nSummary');
    console.log(
      `   Base: ${result.baseSummary.name} (${result.baseSummary.url})`,
    );
    console.log(
      `   Head: ${result.headSummary.name} (${result.headSummary.url})`,
    );
    console.log(
      `   Change Impact Score: ${this.formatScore(result.changeImpactScore, useColor)}`,
    );

    if (result.maxRegressionSeverity) {
      console.log(
        `   Max Regression Severity: ${this.formatSeverity(result.maxRegressionSeverity, useColor)}`,
      );
    }

    // Frame Metrics
    console.log('\nFrame Metrics');
    this.outputMetricTable(result.frameMetrics, useColor);

    // Phase Breakdown
    console.log('\nPhase Breakdown');
    this.outputMetricTable(result.phaseBreakdown, useColor);

    // Regressions
    if (result.regressions.length > 0) {
      console.log(`\n● Regressions (${result.regressions.length})`);
      for (const regression of result.regressions) {
        console.log(this.formatMetricChange(regression, useColor));
      }
    }

    // Improvements
    if (result.improvements.length > 0) {
      console.log(`\n✓ Improvements (${result.improvements.length})`);
      for (const improvement of result.improvements) {
        console.log(this.formatMetricChange(improvement, useColor));
      }
    }

    // Hotspot Changes (verbose mode)
    if (verbose) {
      this.outputHotspotChanges(result, useColor);
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`\n✓ Comparison complete (ID: ${result.id})\n`);
  }

  /**
   * Output metric comparison table
   */
  private outputMetricTable(
    metrics: MetricComparison[],
    useColor: boolean,
  ): void {
    for (const metric of metrics) {
      const arrow = this.getDirectionArrow(metric.direction, useColor);
      const change = this.formatPercentageChange(
        metric.percentageChange,
        metric.direction,
        useColor,
      );
      console.log(
        `   ${metric.name.padEnd(20)} ${String(metric.baseValue).padStart(10)} → ${String(metric.headValue).padStart(10)} ${metric.unit.padEnd(6)} ${arrow} ${change}`,
      );
    }
  }

  /**
   * Output hotspot changes
   */
  private outputHotspotChanges(
    result: ComparisonResult,
    useColor: boolean,
  ): void {
    const { hotspots } = result;

    if (hotspots.layoutThrashing.length > 0) {
      console.log('\nLayout Thrashing Changes');
      for (const h of hotspots.layoutThrashing) {
        const arrow = this.getDirectionArrow(h.direction, useColor);
        console.log(
          `   ${h.selector}: ${h.baseReflowCostMs}ms → ${h.headReflowCostMs}ms ${arrow}`,
        );
      }
    }

    if (hotspots.gpuStalls.length > 0) {
      console.log('\nGPU Stall Changes');
      for (const h of hotspots.gpuStalls) {
        const arrow = this.getDirectionArrow(h.direction, useColor);
        console.log(
          `   ${h.element}: ${h.baseStallMs}ms → ${h.headStallMs}ms ${arrow}`,
        );
      }
    }

    if (hotspots.longTasks.length > 0) {
      console.log('\nLong Task Changes');
      for (const h of hotspots.longTasks) {
        const arrow = this.getDirectionArrow(h.direction, useColor);
        console.log(
          `   ${h.function} (${h.file}): ${h.baseCpuMs}ms → ${h.headCpuMs}ms ${arrow}`,
        );
      }
    }
  }

  /**
   * Check if regressions exceed the fail-on threshold
   */
  private checkFailOnThreshold(
    result: ComparisonResult,
    threshold: Severity,
  ): void {
    const severityOrder: Severity[] = ['info', 'warning', 'high', 'critical'];
    const thresholdIndex = severityOrder.indexOf(threshold);

    // Count regressions at or above threshold
    const violatingRegressions = result.regressions.filter((r) => {
      const regressionIndex = severityOrder.indexOf(r.severity);
      return regressionIndex >= thresholdIndex;
    });

    if (violatingRegressions.length > 0) {
      console.error(
        `\n● ${violatingRegressions.length} regression(s) at or above '${threshold}' severity`,
      );
      for (const r of violatingRegressions) {
        console.error(
          `   - ${r.name}: ${r.percentageChange.toFixed(1)}% (${r.severity})`,
        );
      }
      throw new RegressionDetectedError(violatingRegressions.length, threshold);
    }
  }

  /**
   * Format change impact score with color
   */
  private formatScore(score: number, useColor: boolean): string {
    let color = '';
    let reset = '';

    if (useColor) {
      if (score >= 50) {
        color = '\x1b[31m'; // Red
      } else if (score >= 25) {
        color = '\x1b[33m'; // Yellow
      } else {
        color = '\x1b[32m'; // Green
      }
      reset = '\x1b[0m';
    }

    return `${color}${score}/100${reset}`;
  }

  /**
   * Format severity with color
   */
  private formatSeverity(severity: Severity, useColor: boolean): string {
    if (!useColor) {
      return severity.toUpperCase();
    }

    const colors: Record<Severity, string> = {
      info: '\x1b[36m', // Cyan
      warning: '\x1b[33m', // Yellow
      high: '\x1b[35m', // Magenta
      critical: '\x1b[31m', // Red
    };

    return `${colors[severity]}${severity.toUpperCase()}\x1b[0m`;
  }

  /**
   * Get direction arrow with color
   */
  private getDirectionArrow(direction: string, useColor: boolean): string {
    if (!useColor) {
      switch (direction) {
        case 'regression':
          return '↑';
        case 'improvement':
          return '↓';
        default:
          return '→';
      }
    }

    switch (direction) {
      case 'regression':
        return '\x1b[31m↑\x1b[0m';
      case 'improvement':
        return '\x1b[32m↓\x1b[0m';
      default:
        return '\x1b[90m→\x1b[0m';
    }
  }

  /**
   * Format percentage change with color
   */
  private formatPercentageChange(
    change: number,
    direction: string,
    useColor: boolean,
  ): string {
    const sign = change >= 0 ? '+' : '';
    const formatted = `${sign}${change.toFixed(1)}%`;

    if (!useColor) {
      return formatted;
    }

    switch (direction) {
      case 'regression':
        return `\x1b[31m${formatted}\x1b[0m`;
      case 'improvement':
        return `\x1b[32m${formatted}\x1b[0m`;
      default:
        return `\x1b[90m${formatted}\x1b[0m`;
    }
  }

  /**
   * Format metric change for display
   */
  private formatMetricChange(
    metric: MetricComparison,
    useColor: boolean,
  ): string {
    const severity = this.formatSeverity(metric.severity, useColor);
    const change = this.formatPercentageChange(
      metric.percentageChange,
      metric.direction,
      useColor,
    );
    return `   [${severity}] ${metric.name}: ${metric.baseValue} → ${metric.headValue} ${metric.unit} (${change})`;
  }

  /**
   * Handle errors with appropriate exit codes
   */
  private handleError(
    error: unknown,
    baseTracePath: string,
    headTracePath: string,
  ): never {
    if (error instanceof TraceNotFoundError) {
      console.error(`\n● Trace file not found: ${error.tracePath}`);
      console.error('   Make sure the file path is correct');
      process.exit(error.exitCode);
    }

    if (error instanceof TraceParseError) {
      console.error(`\n● Failed to parse trace file: ${error.tracePath}`);
      console.error(
        '   Make sure the file contains valid JSON trace summary data',
      );
      if (error.cause) {
        console.error(`   Cause: ${error.cause.message}`);
      }
      process.exit(error.exitCode);
    }

    if (error instanceof RegressionDetectedError) {
      process.exit(error.exitCode);
    }

    // Unknown error
    console.error('\n● An unexpected error occurred during comparison');
    console.error(`   Base trace: ${baseTracePath}`);
    console.error(`   Head trace: ${headTracePath}`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    process.exit(1);
  }

  @Option({
    flags: '--json',
    description: 'Output results in JSON format',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --latest',
    description: 'Compare base against the most recent trace',
    defaultValue: false,
  })
  parseLatest(): boolean {
    return true;
  }

  @Option({
    flags: '--fail-on <severity>',
    description:
      'Exit with non-zero code if regressions meet or exceed severity (info, warning, high, critical)',
  })
  parseFailOn(val: string): Severity {
    const validSeverities: Severity[] = ['info', 'warning', 'high', 'critical'];
    if (!validSeverities.includes(val as Severity)) {
      console.error(
        `Invalid severity: ${val}. Must be one of: ${validSeverities.join(', ')}`,
      );
      process.exit(1);
    }
    return val as Severity;
  }

  @Option({
    flags: '-v, --verbose',
    description: 'Show verbose output with hotspot changes',
    defaultValue: false,
  })
  parseVerbose(): boolean {
    return true;
  }

  @Option({
    flags: '--no-color',
    description: 'Disable colored output',
    defaultValue: false,
  })
  parseNoColor(): boolean {
    return true;
  }
}
