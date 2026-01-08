/**
 * Monitor Service - Continuous performance monitoring with rule evaluation
 */

import { Injectable } from '@nestjs/common';
import { CDPConnectionService } from '../cdp/cdp-connection.service.js';
import { TracingService } from '../cdp/tracing.service.js';
import { ScenarioRunnerService } from '../recorder/scenario-runner.service.js';
import { ConfigService } from '../services/config.service.js';
import { RulesService } from '../rules/rules.service.js';
import { RollingWindowService } from './rolling-window.service.js';
import type {
  IMonitorService,
  MonitorOptions,
  RollingMetrics,
  Violation,
  ViolationHandler,
  FrameSample,
} from './interfaces/monitor.interface.js';
import type {
  RuleSet,
  RuleEvaluation,
} from '../rules/interfaces/rules.interface.js';

/** Default frame budget for 60fps */
const DEFAULT_FRAME_BUDGET_MS = 16.67;

/** Polling interval for trace collection (ms) */
const POLL_INTERVAL_MS = 1000;

@Injectable()
export class MonitorService implements IMonitorService {
  private monitoring = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private violationHandlers: ViolationHandler[] = [];
  private rules: RuleSet | null = null;
  private frameBudgetMs = DEFAULT_FRAME_BUDGET_MS;

  constructor(
    private readonly cdpConnection: CDPConnectionService,
    private readonly tracingService: TracingService,
    private readonly scenarioRunner: ScenarioRunnerService,
    private readonly configService: ConfigService,
    private readonly rulesService: RulesService,
    private readonly rollingWindow: RollingWindowService,
  ) {}

  /**
   * Start continuous monitoring
   */
  async start(options: MonitorOptions): Promise<void> {
    if (this.monitoring) {
      throw new Error('Monitor is already running');
    }

    this.monitoring = true;
    this.rollingWindow.reset();

    // Load config and rules
    const config = await this.configService.loadConfig();
    const rulesPath = '.render-debugger/rules.yaml';

    try {
      this.rules = await this.rulesService.loadRules(rulesPath);
    } catch {
      // Use default rules if file doesn't exist
      this.rules = this.rulesService.getDefaultRules();
    }

    // Calculate frame budget from config or default
    const fpsTarget = config?.profiling.defaultFpsTarget ?? 60;
    this.frameBudgetMs = 1000 / fpsTarget;

    // Connect to browser
    await this.cdpConnection.connect({
      browserPath: config?.browser.path,
      cdpPort: config?.browser.defaultCdpPort ?? 9222,
      headless: false, // Monitor typically runs with visible browser
    });

    // Enable required domains
    const client = this.cdpConnection.getClient();
    if (client) {
      await client.send('Page.enable', {});
      await client.send('Runtime.enable', {});
      await client.send('Performance.enable', {});
    }

    // Navigate to URL
    await this.navigateToUrl(options.url);

    // Load and start scenario if provided
    if (options.scenario) {
      const scenario = await this.scenarioRunner.loadScenario(options.scenario);
      // Run scenario in background (non-blocking)
      void this.runScenarioLoop(scenario);
    }

    // Start continuous trace collection
    await this.startTraceCollection();

    // Start polling for metrics
    this.startPolling();
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop tracing
    try {
      await this.tracingService.stopTracing();
    } catch {
      // Ignore errors when stopping
    }

    // Disconnect from browser
    await this.cdpConnection.disconnect();
  }

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean {
    return this.monitoring;
  }

  /**
   * Get current rolling metrics
   */
  getMetrics(): RollingMetrics {
    return this.rollingWindow.getMetrics();
  }

  /**
   * Register a violation handler
   */
  onViolation(handler: ViolationHandler): void {
    this.violationHandlers.push(handler);
  }

  /**
   * Remove a violation handler
   */
  offViolation(handler: ViolationHandler): void {
    const index = this.violationHandlers.indexOf(handler);
    if (index !== -1) {
      this.violationHandlers.splice(index, 1);
    }
  }

  /**
   * Navigate to URL and wait for load
   */
  private async navigateToUrl(url: string): Promise<void> {
    const client = this.cdpConnection.getClient();
    if (!client) return;

    await client.send('Page.navigate', { url });

    // Wait for load event
    await new Promise<void>((resolve) => {
      const handler = () => {
        client.off('Page.loadEventFired', handler);
        resolve();
      };
      client.on('Page.loadEventFired', handler);

      // Timeout after 30 seconds
      setTimeout(() => {
        client.off('Page.loadEventFired', handler);
        resolve();
      }, 30000);
    });
  }

  /**
   * Run scenario in a loop
   */
  private async runScenarioLoop(
    scenario: Parameters<typeof this.scenarioRunner.runScenario>[0],
  ): Promise<void> {
    while (this.monitoring) {
      try {
        await this.scenarioRunner.runScenario(scenario);
      } catch {
        // Continue monitoring even if scenario fails
      }

      // Small delay between scenario runs
      await this.delay(1000);
    }
  }

  /**
   * Start continuous trace collection
   */
  private async startTraceCollection(): Promise<void> {
    await this.tracingService.startTracing({
      categories: ['devtools.timeline', 'blink.user_timing'],
    });
  }

  /**
   * Start polling for metrics
   */
  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.collectAndEvaluateMetrics();
    }, POLL_INTERVAL_MS);
  }

  /**
   * Collect metrics and evaluate rules
   */
  private async collectAndEvaluateMetrics(): Promise<void> {
    if (!this.monitoring) return;

    try {
      // Get performance metrics from CDP
      const client = this.cdpConnection.getClient();
      if (!client) return;

      const { metrics } = (await client.send('Performance.getMetrics', {})) as {
        metrics: Array<{ name: string; value: number }>;
      };

      // Extract frame-related metrics
      const frameMetrics = this.extractFrameMetrics(metrics);

      // Add samples to rolling window
      for (const sample of frameMetrics) {
        this.rollingWindow.addSample(sample);
      }

      // Evaluate rules against current metrics
      this.evaluateRules();
    } catch {
      // Continue monitoring even if collection fails
    }
  }

  /**
   * Extract frame metrics from CDP performance metrics
   */
  private extractFrameMetrics(
    metrics: Array<{ name: string; value: number }>,
  ): FrameSample[] {
    const samples: FrameSample[] = [];
    const now = Date.now();

    // Find relevant metrics
    const framesMetric = metrics.find((m) => m.name === 'Frames');
    const taskDuration = metrics.find((m) => m.name === 'TaskDuration');

    if (framesMetric && taskDuration) {
      // Estimate frame time from task duration
      const frameTime = taskDuration.value * 1000; // Convert to ms
      const dropped = frameTime > this.frameBudgetMs;

      samples.push({
        timestamp: now,
        frameTime: Math.max(frameTime, this.frameBudgetMs),
        dropped,
      });
    } else {
      // Fallback: create a sample based on poll interval
      samples.push({
        timestamp: now,
        frameTime: this.frameBudgetMs,
        dropped: false,
      });
    }

    return samples;
  }

  /**
   * Evaluate rules against current metrics
   */
  private evaluateRules(): void {
    if (!this.rules) return;

    const metrics = this.rollingWindow.getMetrics();
    const windowMetrics = metrics.windows['1m']; // Use 1m window for rule evaluation

    // Map window metrics to rule metrics
    const ruleMetrics = {
      p95_frame_time: windowMetrics.p95FrameTime,
      dropped_frames_pct: windowMetrics.droppedFramesPct,
    };

    // Evaluate all rules
    const result = this.rulesService.evaluateAllRules(this.rules, ruleMetrics);

    // Process violations
    for (const evaluation of result.violations) {
      const violation: Violation = {
        ruleId: evaluation.rule.id,
        ruleName: evaluation.rule.name,
        severity: evaluation.triggeredSeverity ?? 'warning',
        actualValue: evaluation.value,
        threshold: this.getTriggeredThreshold(evaluation),
        timestamp: new Date(),
      };

      // Add to rolling window
      this.rollingWindow.addViolation(violation);

      // Notify handlers
      this.notifyViolation(violation);
    }
  }

  /**
   * Get the threshold that was triggered
   */
  private getTriggeredThreshold(evaluation: RuleEvaluation): number {
    if (!evaluation.triggeredSeverity) return 0;

    const thresholds = evaluation.rule.thresholds;
    const severity = evaluation.triggeredSeverity;

    switch (severity) {
      case 'info':
        return thresholds.info ?? 0;
      case 'warning':
        return thresholds.warning ?? 0;
      case 'high':
        return thresholds.high ?? 0;
      case 'critical':
        return thresholds.critical ?? 0;
      default:
        return 0;
    }
  }

  /**
   * Notify all violation handlers
   */
  private notifyViolation(violation: Violation): void {
    for (const handler of this.violationHandlers) {
      try {
        handler(violation);
      } catch {
        // Continue notifying other handlers
      }
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
