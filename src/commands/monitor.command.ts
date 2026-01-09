/**
 * Monitor Command - Continuous performance monitoring with rule evaluation
 */

import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MonitorService } from '../monitor/monitor.service.js';
import type {
  Violation,
  MonitorOptions,
} from '../monitor/interfaces/monitor.interface.js';
import { ICONS } from '../shared/utils/console-icons.js';

const execAsync = promisify(exec);

interface MonitorCommandOptions {
  url: string;
  scenario: string;
  rolling?: number;
  alertCmd?: string;
  browserPath?: string;
  cdpPort?: number;
  cdpHost?: string;
  adapter?: string;
}

/** Severity colors for terminal output */
const SEVERITY_COLORS: Record<string, string> = {
  info: '\x1b[36m', // Cyan
  warning: '\x1b[33m', // Yellow
  high: '\x1b[31m', // Red
  critical: '\x1b[35m', // Magenta
};

const RESET_COLOR = '\x1b[0m';

@Injectable()
@Command({
  name: 'monitor',
  aliases: ['m'],
  description: 'Continuously monitor rendering performance',
})
export class MonitorCommand extends CommandRunner {
  private isRunning = false;

  constructor(private readonly monitorService: MonitorService) {
    super();
  }

  async run(
    _passedParams: string[],
    options: MonitorCommandOptions,
  ): Promise<void> {
    try {
      console.log(
        `${ICONS.start} Starting continuous performance monitor...\n`,
      );
      console.log(`   URL: ${options.url}`);
      console.log(`   Scenario: ${options.scenario}`);
      console.log(`   Rolling window: ${options.rolling ?? 60}s`);
      if (options.alertCmd) {
        console.log(`   Alert command: ${options.alertCmd}`);
      }
      console.log('');

      this.isRunning = true;

      // Set up violation handler
      const alertCmd = options.alertCmd;
      this.monitorService.onViolation((violation) => {
        void this.handleViolation(violation, alertCmd);
      });

      // Set up graceful shutdown
      this.setupShutdownHandlers();

      // Build monitor options
      const monitorOptions: MonitorOptions = {
        url: options.url,
        scenario: options.scenario,
        rollingWindowSeconds: options.rolling ?? 60,
        alertCmd: options.alertCmd,
      };

      // Start monitoring
      await this.monitorService.start(monitorOptions);

      console.log(
        `${ICONS.running} Monitor is running. Press Ctrl+C to stop.\n`,
      );

      // Start metrics display loop
      await this.displayMetricsLoop();
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Handle a rule violation
   */
  private async handleViolation(
    violation: Violation,
    alertCmd?: string,
  ): Promise<void> {
    const color = SEVERITY_COLORS[violation.severity] ?? '';
    const timestamp = violation.timestamp.toISOString().substring(11, 19);

    console.log(
      `\n${ICONS.warning} ${color}[${violation.severity.toUpperCase()}]${RESET_COLOR} ` +
        `Rule violation at ${timestamp}`,
    );
    console.log(`   Rule: ${violation.ruleName} (${violation.ruleId})`);
    console.log(
      `   Value: ${violation.actualValue} (threshold: ${violation.threshold})`,
    );

    // Execute alert command if provided
    if (alertCmd) {
      try {
        console.log(`   ${ICONS.running} Executing alert command...`);
        const { stdout, stderr } = await execAsync(alertCmd, {
          env: {
            ...process.env,
            RENDER_DEBUGGER_RULE_ID: violation.ruleId,
            RENDER_DEBUGGER_RULE_NAME: violation.ruleName,
            RENDER_DEBUGGER_SEVERITY: violation.severity,
            RENDER_DEBUGGER_VALUE: String(violation.actualValue),
            RENDER_DEBUGGER_THRESHOLD: String(violation.threshold),
          },
        });
        if (stdout) console.log(`   ${stdout.trim()}`);
        if (stderr) console.error(`   ${stderr.trim()}`);
      } catch (error) {
        console.error(
          `   ${ICONS.error} Alert command failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  /**
   * Display metrics in a loop
   */
  private async displayMetricsLoop(): Promise<void> {
    const displayInterval = 5000; // Update display every 5 seconds

    while (this.isRunning && this.monitorService.isMonitoring()) {
      await this.delay(displayInterval);

      if (!this.isRunning) break;

      const metrics = this.monitorService.getMetrics();
      this.displayMetrics(metrics);
    }
  }

  /**
   * Display current metrics
   */
  private displayMetrics(
    metrics: ReturnType<typeof this.monitorService.getMetrics>,
  ): void {
    // Clear previous line and display updated metrics
    process.stdout.write('\r\x1b[K'); // Clear line

    const w1m = metrics.windows['1m'];
    const w5m = metrics.windows['5m'];
    const w15m = metrics.windows['15m'];

    console.log(`\n${ICONS.analyze} Rolling Window Metrics:`);
    console.log(
      '┌─────────┬──────────┬──────────────┬─────────────┬─────────┐',
    );
    console.log(
      '│ Window  │ Avg FPS  │ Dropped (%)  │ P95 Frame   │ Samples │',
    );
    console.log(
      '├─────────┼──────────┼──────────────┼─────────────┼─────────┤',
    );
    console.log(
      `│ 1m      │ ${this.padNumber(w1m.avgFps, 8)} │ ${this.padNumber(w1m.droppedFramesPct, 12)} │ ${this.padNumber(w1m.p95FrameTime, 11)}ms │ ${this.padNumber(w1m.samples, 7)} │`,
    );
    console.log(
      `│ 5m      │ ${this.padNumber(w5m.avgFps, 8)} │ ${this.padNumber(w5m.droppedFramesPct, 12)} │ ${this.padNumber(w5m.p95FrameTime, 11)}ms │ ${this.padNumber(w5m.samples, 7)} │`,
    );
    console.log(
      `│ 15m     │ ${this.padNumber(w15m.avgFps, 8)} │ ${this.padNumber(w15m.droppedFramesPct, 12)} │ ${this.padNumber(w15m.p95FrameTime, 11)}ms │ ${this.padNumber(w15m.samples, 7)} │`,
    );
    console.log(
      '└─────────┴──────────┴──────────────┴─────────────┴─────────┘',
    );

    // Show recent violations
    const violations = metrics.violations;
    if (violations.length > 0) {
      const recentViolations = violations.slice(-5); // Show last 5
      console.log(
        `\n${ICONS.warning} Recent Violations (${violations.length} total):`,
      );
      for (const v of recentViolations) {
        const color = SEVERITY_COLORS[v.severity] ?? '';
        const time = v.timestamp.toISOString().substring(11, 19);
        console.log(
          `   ${color}[${v.severity.toUpperCase()}]${RESET_COLOR} ${time} - ${v.ruleName}: ${v.actualValue} > ${v.threshold}`,
        );
      }
    }
  }

  /**
   * Pad a number for table display
   */
  private padNumber(value: number, width: number): string {
    return String(value).padStart(width);
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = () => {
      if (!this.isRunning) return;

      console.log(`\n\n${ICONS.stop} Stopping monitor...`);
      this.isRunning = false;

      this.monitorService
        .stop()
        .then(() => {
          console.log(`${ICONS.success} Monitor stopped gracefully.`);

          // Display final summary
          const metrics = this.monitorService.getMetrics();
          const totalViolations = metrics.violations.length;
          if (totalViolations > 0) {
            console.log(
              `\n${ICONS.warning} Total violations during session: ${totalViolations}`,
            );

            // Count by severity
            const bySeverity: Record<string, number> = {};
            for (const v of metrics.violations) {
              bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
            }
            for (const [severity, count] of Object.entries(bySeverity)) {
              const color = SEVERITY_COLORS[severity] ?? '';
              console.log(`   ${color}${severity}${RESET_COLOR}: ${count}`);
            }
          } else {
            console.log(
              `\n${ICONS.success} No rule violations during session.`,
            );
          }

          process.exit(0);
        })
        .catch((error: unknown) => {
          console.error(`${ICONS.error} Error during shutdown:`, error);
          process.exit(1);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Handle errors
   */
  private handleError(error: unknown): never {
    console.error(`\n${ICONS.error} Monitor error:`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    process.exit(1);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  @Option({
    flags: '-u, --url <url>',
    description: 'URL to monitor',
    required: true,
  })
  parseUrl(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --scenario <scenario>',
    description: 'Scenario name to run continuously',
    required: true,
  })
  parseScenario(val: string): string {
    return val;
  }

  @Option({
    flags: '-r, --rolling <seconds>',
    description: 'Rolling window duration in seconds (default: 60)',
    defaultValue: 60,
  })
  parseRolling(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-a, --alert-cmd <command>',
    description: 'Command to execute when rule violations occur',
  })
  parseAlertCmd(val: string): string {
    return val;
  }

  @Option({
    flags: '-b, --browser-path <path>',
    description: 'Path to Chromium-based browser executable',
  })
  parseBrowserPath(val: string): string {
    return val;
  }

  @Option({
    flags: '-p, --cdp-port <port>',
    description: 'CDP port to connect to',
  })
  parseCdpPort(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--cdp-host <host>',
    description: 'CDP host to connect to (default: localhost)',
  })
  parseCdpHost(val: string): string {
    return val;
  }

  @Option({
    flags: '--adapter <type>',
    description: 'Browser adapter to use (chromium-cdp, webkit-native)',
  })
  parseAdapter(val: string): string {
    return val;
  }
}
