import { Injectable } from '@nestjs/common';
import { CDPConnectionService } from './cdp-connection.service.js';
import type {
  ITracingService,
  TracingOptions,
  TraceData,
  TraceEvent,
  TraceMetadata,
} from './interfaces/index.js';

/**
 * Default trace categories for rendering performance analysis
 */
export const DEFAULT_TRACE_CATEGORIES = [
  'devtools.timeline',
  'blink.user_timing',
  'gpu',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
];

@Injectable()
export class TracingService implements ITracingService {
  private tracing = false;
  private traceEvents: TraceEvent[] = [];
  private tracingCompletePromise: Promise<void> | null = null;
  private tracingCompleteResolve: (() => void) | null = null;

  constructor(private readonly cdpConnection: CDPConnectionService) {}

  /**
   * Start tracing with specified categories
   */
  async startTracing(options: TracingOptions): Promise<void> {
    if (this.tracing) {
      throw new Error('Tracing is already in progress');
    }

    const client = this.cdpConnection.getClient();
    if (!client) {
      throw new Error('CDP client not connected');
    }

    // Reset trace events
    this.traceEvents = [];

    // Set up event handlers for trace data collection
    this.setupTraceHandlers(client);

    // Create promise for tracing completion
    this.tracingCompletePromise = new Promise((resolve) => {
      this.tracingCompleteResolve = resolve;
    });

    // Start tracing
    const categories = options.categories.join(',');
    await client.send('Tracing.start', {
      categories,
      options: 'sampling-frequency=10000',
      bufferUsageReportingInterval: options.bufferUsageReportingInterval ?? 500,
      transferMode: options.transferMode ?? 'ReportEvents',
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        includedCategories: options.categories,
      },
    });

    this.tracing = true;
  }

  /**
   * Stop tracing and return collected trace data
   */
  async stopTracing(): Promise<TraceData> {
    if (!this.tracing) {
      throw new Error('Tracing is not in progress');
    }

    const client = this.cdpConnection.getClient();
    if (!client) {
      throw new Error('CDP client not connected');
    }

    // End tracing
    await client.send('Tracing.end', {});

    // Wait for tracing to complete
    if (this.tracingCompletePromise) {
      await this.tracingCompletePromise;
    }

    this.tracing = false;

    // Build trace data
    const browserInfo = this.cdpConnection.getBrowserInfo();
    const metadata: TraceMetadata = {
      browser_version: browserInfo?.browserVersion ?? 'unknown',
      user_agent: browserInfo?.userAgent ?? 'unknown',
      viewport: { width: 0, height: 0 },
      device_pixel_ratio: 1,
      timestamp: new Date().toISOString(),
      scenario: '',
      fps_target: 60,
    };

    return {
      traceEvents: [...this.traceEvents],
      metadata,
    };
  }

  /**
   * Check if tracing is in progress
   */
  isTracing(): boolean {
    return this.tracing;
  }

  /**
   * Get available trace categories
   */
  getCategories(): string[] {
    return [...DEFAULT_TRACE_CATEGORIES];
  }

  /**
   * Set up handlers for trace data collection
   */
  private setupTraceHandlers(
    client: ReturnType<CDPConnectionService['getClient']>,
  ): void {
    if (!client) return;

    // Handle trace data chunks
    client.on('Tracing.dataCollected', (params: unknown) => {
      const data = params as { value: TraceEvent[] };
      if (data.value && Array.isArray(data.value)) {
        this.traceEvents.push(...data.value);
      }
    });

    // Handle tracing complete
    client.on('Tracing.tracingComplete', () => {
      if (this.tracingCompleteResolve) {
        this.tracingCompleteResolve();
        this.tracingCompleteResolve = null;
        this.tracingCompletePromise = null;
      }
    });
  }
}
