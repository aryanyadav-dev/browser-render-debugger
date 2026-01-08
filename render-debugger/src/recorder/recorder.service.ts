import { Injectable } from '@nestjs/common';
import { CDPConnectionService } from '../cdp/cdp-connection.service.js';
import {
  TracingService,
  DEFAULT_TRACE_CATEGORIES,
} from '../cdp/tracing.service.js';
import { ScenarioRunnerService } from './scenario-runner.service.js';
import { StorageService } from '../services/storage.service.js';
import { ConfigService } from '../services/config.service.js';
import { InvalidURLError } from '../errors/error-types.js';
import type {
  TraceData,
  TraceSummary,
  Scenario,
  ScenarioResult,
} from '../shared/types/index.js';

export interface ProfileOptions {
  url: string;
  scenario: string;
  browserPath?: string;
  duration: number;
  headless: boolean;
  fpsTarget: number;
  cdpPort?: number;
  outputPath?: string;
}

export interface ProfileResult {
  traceData: TraceData;
  summary: TraceSummary;
  scenarioResult: ScenarioResult;
  tracePath: string;
  summaryPath: string;
  exitCode: number;
}

@Injectable()
export class RecorderService {
  constructor(
    private readonly cdpConnection: CDPConnectionService,
    private readonly tracingService: TracingService,
    private readonly scenarioRunner: ScenarioRunnerService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Profile a URL with a scenario
   */
  async profile(options: ProfileOptions): Promise<ProfileResult> {
    // Validate URL
    if (!this.isValidUrl(options.url)) {
      throw new InvalidURLError(options.url);
    }

    // Load config for defaults
    const config = await this.configService.loadConfig();
    const browserPath = options.browserPath ?? config?.browser.path;
    const cdpPort = options.cdpPort ?? config?.browser.defaultCdpPort ?? 9222;
    const traceCategories =
      config?.profiling.traceCategories ?? DEFAULT_TRACE_CATEGORIES;

    // Connect to browser
    await this.cdpConnection.connect({
      browserPath,
      cdpPort,
      headless: options.headless,
    });

    try {
      // Enable required domains
      const client = this.cdpConnection.getClient();
      if (client) {
        await client.send('Page.enable', {});
        await client.send('Runtime.enable', {});
      }

      // Navigate to URL
      await this.navigateToUrl(options.url);

      // Load scenario
      const scenario = await this.scenarioRunner.loadScenario(options.scenario);

      // Start tracing
      await this.tracingService.startTracing({
        categories: traceCategories,
      });

      // Run scenario with duration limit
      const scenarioResult = await this.runScenarioWithTimeout(
        scenario,
        options.duration * 1000,
      );

      // Stop tracing
      const traceData = await this.tracingService.stopTracing();

      // Update trace metadata
      traceData.metadata = {
        ...traceData.metadata,
        scenario: options.scenario,
        fps_target: options.fpsTarget,
        timestamp: new Date().toISOString(),
      };

      // Generate summary
      const summary = this.generateSummary(traceData, options);

      // Generate run ID
      const runId = this.generateRunId(options);

      // Write artifacts
      const tracePath = options.outputPath
        ? await this.writeTraceToPath(options.outputPath, traceData)
        : await this.storageService.writeTrace(runId, traceData);

      const summaryPath = await this.storageService.writeSummary(
        runId,
        summary,
      );

      return {
        traceData,
        summary,
        scenarioResult,
        tracePath,
        summaryPath,
        exitCode: 0,
      };
    } finally {
      await this.cdpConnection.disconnect();
    }
  }

  /**
   * Navigate to a URL and wait for load
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
    });

    // Additional wait for any async content
    await this.delay(1000);
  }

  /**
   * Run scenario with a timeout
   */
  private async runScenarioWithTimeout(
    scenario: Scenario,
    timeoutMs: number,
  ): Promise<ScenarioResult> {
    const startTime = Date.now();

    // Run the scenario
    const result = await this.scenarioRunner.runScenario(scenario);

    // If scenario finished early, wait for remaining duration
    const elapsed = Date.now() - startTime;
    if (elapsed < timeoutMs) {
      await this.delay(timeoutMs - elapsed);
    }

    return result;
  }

  /**
   * Generate a trace summary from trace data
   */
  private generateSummary(
    traceData: TraceData,
    options: ProfileOptions,
  ): TraceSummary {
    const frameMetrics = this.calculateFrameMetrics(
      traceData,
      options.fpsTarget,
    );
    const phaseBreakdown = this.calculatePhaseBreakdown(traceData);

    return {
      id: this.generateUniqueId(),
      name: options.scenario,
      url: options.url,
      duration_ms: options.duration * 1000,
      frames: frameMetrics,
      phase_breakdown: phaseBreakdown,
      hotspots: {
        layout_thrashing: [],
        gpu_stalls: [],
        long_tasks: [],
      },
      suggestions: [],
      metadata: traceData.metadata,
    };
  }

  /**
   * Calculate frame metrics from trace data
   */
  private calculateFrameMetrics(
    traceData: TraceData,
    fpsTarget: number,
  ): TraceSummary['frames'] {
    const frameBudgetMs = 1000 / fpsTarget;
    const frameEvents = traceData.traceEvents.filter(
      (e) => e.name === 'BeginFrame' || e.name === 'DrawFrame',
    );

    // Calculate frame timings
    const frameTimes: number[] = [];
    for (let i = 1; i < frameEvents.length; i++) {
      const currentEvent = frameEvents[i];
      const prevEvent = frameEvents[i - 1];
      if (currentEvent && prevEvent) {
        const delta = (currentEvent.ts - prevEvent.ts) / 1000; // Convert to ms
        frameTimes.push(delta);
      }
    }

    const totalFrames = Math.max(frameTimes.length, 1);
    const droppedFrames = frameTimes.filter((t) => t > frameBudgetMs).length;
    const avgFrameTime =
      frameTimes.length > 0
        ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
        : frameBudgetMs;
    const avgFps = avgFrameTime > 0 ? 1000 / avgFrameTime : fpsTarget;

    return {
      total: totalFrames,
      dropped: droppedFrames,
      avg_fps: Math.round(avgFps * 10) / 10,
      frame_budget_ms: frameBudgetMs,
    };
  }

  /**
   * Calculate phase breakdown from trace data
   */
  private calculatePhaseBreakdown(
    traceData: TraceData,
  ): TraceSummary['phase_breakdown'] {
    let styleRecalcMs = 0;
    let layoutMs = 0;
    let paintMs = 0;
    let compositeMs = 0;
    let gpuMs = 0;

    for (const event of traceData.traceEvents) {
      const durationMs = (event.dur ?? 0) / 1000;

      switch (event.name) {
        case 'UpdateLayoutTree':
        case 'RecalculateStyles':
          styleRecalcMs += durationMs;
          break;
        case 'Layout':
          layoutMs += durationMs;
          break;
        case 'Paint':
        case 'PaintImage':
          paintMs += durationMs;
          break;
        case 'CompositeLayers':
        case 'UpdateLayer':
          compositeMs += durationMs;
          break;
        case 'GPUTask':
        case 'RasterTask':
          gpuMs += durationMs;
          break;
      }
    }

    return {
      style_recalc_ms: Math.round(styleRecalcMs * 100) / 100,
      layout_ms: Math.round(layoutMs * 100) / 100,
      paint_ms: Math.round(paintMs * 100) / 100,
      composite_ms: Math.round(compositeMs * 100) / 100,
      gpu_ms: Math.round(gpuMs * 100) / 100,
    };
  }

  /**
   * Write trace to a specific path
   */
  private async writeTraceToPath(
    outputPath: string,
    traceData: TraceData,
  ): Promise<string> {
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, JSON.stringify(traceData, null, 2), 'utf-8');
    return outputPath;
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(options: ProfileOptions): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${options.scenario}-${timestamp}`;
  }

  /**
   * Generate a unique ID
   */
  private generateUniqueId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
