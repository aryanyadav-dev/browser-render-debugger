/**
 * Browser Adapter Interface
 *
 * Defines the contract for browser adapters that collect trace data
 * from different browser platforms (Chromium CDP, WebKit native, etc.)
 *
 * Requirements: 15.3
 */

import type { TraceSnapshot, TraceSnapshotOptions } from '../models/index.js';

/**
 * Adapter capabilities - what features the adapter supports
 */
export enum AdapterCapability {
  /** Full CDP access - complete rendering pipeline visibility */
  FULL_CDP = 'full_cdp',
  /** Frame timing collection */
  FRAME_TIMING = 'frame_timing',
  /** Long task detection (> 50ms) */
  LONG_TASKS = 'long_tasks',
  /** DOM signals (layout invalidation, style recalc, etc.) */
  DOM_SIGNALS = 'dom_signals',
  /** GPU event tracking */
  GPU_EVENTS = 'gpu_events',
  /** Paint event tracking */
  PAINT_EVENTS = 'paint_events',
  /** Source map resolution */
  SOURCE_MAPS = 'source_maps',
  /** Live monitoring support */
  LIVE_MONITORING = 'live_monitoring',
}

/**
 * Adapter type identifiers
 */
export type AdapterType =
  | 'chromium-cdp'
  | 'webkit-native'
  | 'firefox-rdp'
  | 'custom';

/**
 * Connection options for browser adapters
 */
export interface AdapterConnectionOptions {
  /** Browser executable path (for launching) */
  browserPath?: string;
  /** CDP/debug port for connection */
  port?: number;
  /** Host for remote connection */
  host?: string;
  /** WebSocket endpoint for direct connection */
  wsEndpoint?: string;
  /** Run browser in headless mode */
  headless?: boolean;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Additional browser launch arguments */
  launchArgs?: string[];
  /** Directory for trace file ingestion (native adapters) */
  traceDir?: string;
}

/**
 * Trace collection options
 */
export interface TraceCollectionOptions extends TraceSnapshotOptions {
  /** Duration to collect trace in milliseconds */
  durationMs?: number;
  /** URL to navigate to before tracing */
  url?: string;
  /** Scenario to execute during tracing */
  scenario?: string;
  /** Target FPS for frame budget calculation */
  fpsTarget?: number;
  /** Categories to trace (CDP-specific) */
  traceCategories?: string[];
  /** Sampling rate (0.0 - 1.0) */
  samplingRate?: number;
  /** Include raw trace events in output */
  includeRawEvents?: boolean;
}

/**
 * Adapter status information
 */
export interface AdapterStatus {
  /** Whether the adapter is connected */
  connected: boolean;
  /** Whether trace collection is in progress */
  collecting: boolean;
  /** Browser version if connected */
  browserVersion?: string;
  /** Platform identifier */
  platform?: string;
  /** Last error if any */
  lastError?: string;
  /** Connection timestamp */
  connectedAt?: Date;
}

/**
 * Adapter metadata for registration
 */
export interface AdapterMetadata {
  /** Unique adapter type identifier */
  type: AdapterType;
  /** Human-readable name */
  name: string;
  /** Description of the adapter */
  description: string;
  /** Supported capabilities */
  capabilities: AdapterCapability[];
  /** Supported browser patterns (for auto-detection) */
  browserPatterns?: RegExp[];
  /** Priority for auto-selection (higher = preferred) */
  priority?: number;
}

/**
 * Browser Adapter Interface
 *
 * All browser adapters must implement this interface to provide
 * a consistent API for trace collection across different platforms.
 */
export interface IBrowserAdapter {
  /**
   * Get adapter metadata
   */
  readonly metadata: AdapterMetadata;

  /**
   * Connect to the browser
   * @param options Connection options
   * @returns Promise that resolves when connected
   */
  connect(options: AdapterConnectionOptions): Promise<void>;

  /**
   * Disconnect from the browser
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void>;

  /**
   * Check if adapter is connected
   */
  isConnected(): boolean;

  /**
   * Get current adapter status
   */
  getStatus(): AdapterStatus;

  /**
   * Collect a trace snapshot
   * @param options Trace collection options
   * @returns Promise resolving to a TraceSnapshot
   */
  collectTrace(options: TraceCollectionOptions): Promise<TraceSnapshot>;

  /**
   * Check if adapter supports a specific capability
   * @param capability The capability to check
   */
  hasCapability(capability: AdapterCapability): boolean;

  /**
   * Get all supported capabilities
   */
  getCapabilities(): AdapterCapability[];

  /**
   * Navigate to a URL (if supported)
   * @param url URL to navigate to
   */
  navigateTo?(url: string): Promise<void>;

  /**
   * Execute a scenario script (if supported)
   * @param scenario Scenario name or script
   */
  executeScenario?(scenario: string): Promise<void>;
}

/**
 * Abstract base class for browser adapters
 * Provides common functionality and default implementations
 */
export abstract class BaseBrowserAdapter implements IBrowserAdapter {
  abstract readonly metadata: AdapterMetadata;

  protected _connected = false;
  protected _collecting = false;
  protected _browserVersion?: string;
  protected _connectedAt?: Date;
  protected _lastError?: string;

  abstract connect(options: AdapterConnectionOptions): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract collectTrace(
    options: TraceCollectionOptions,
  ): Promise<TraceSnapshot>;

  isConnected(): boolean {
    return this._connected;
  }

  getStatus(): AdapterStatus {
    return {
      connected: this._connected,
      collecting: this._collecting,
      browserVersion: this._browserVersion,
      platform: this.metadata.type,
      lastError: this._lastError,
      connectedAt: this._connectedAt,
    };
  }

  hasCapability(capability: AdapterCapability): boolean {
    return this.metadata.capabilities.includes(capability);
  }

  getCapabilities(): AdapterCapability[] {
    return [...this.metadata.capabilities];
  }

  /**
   * Helper to set connected state
   */
  protected setConnected(connected: boolean, browserVersion?: string): void {
    this._connected = connected;
    this._browserVersion = browserVersion;
    this._connectedAt = connected ? new Date() : undefined;
    if (!connected) {
      this._collecting = false;
    }
  }

  /**
   * Helper to set collecting state
   */
  protected setCollecting(collecting: boolean): void {
    this._collecting = collecting;
  }

  /**
   * Helper to set last error
   */
  protected setError(error: string | undefined): void {
    this._lastError = error;
  }
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory = () => IBrowserAdapter;

/**
 * Adapter registration info for the registry
 */
export interface AdapterRegistration {
  /** Adapter metadata */
  metadata: AdapterMetadata;
  /** Factory function to create adapter instances */
  factory: AdapterFactory;
}
