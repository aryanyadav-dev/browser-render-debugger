/**
 * Adapter Registry Service
 *
 * Manages browser adapter registration, discovery, and selection.
 * Supports runtime adapter selection via --adapter flag and
 * auto-detection based on browser type.
 *
 * Requirements: 15.4
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  IBrowserAdapter,
  AdapterRegistration,
  AdapterType,
  AdapterMetadata,
  AdapterConnectionOptions,
} from './interfaces/index.js';

/**
 * Options for adapter selection
 */
export interface AdapterSelectionOptions {
  /** Explicitly specified adapter type */
  adapterType?: AdapterType;
  /** Browser path for auto-detection */
  browserPath?: string;
  /** Browser name hint for auto-detection */
  browserName?: string;
}

/**
 * Result of adapter auto-detection
 */
export interface AdapterDetectionResult {
  /** Detected adapter type */
  adapterType: AdapterType;
  /** Confidence level of detection */
  confidence: 'high' | 'medium' | 'low';
  /** Reason for selection */
  reason: string;
}

@Injectable()
export class AdapterRegistryService {
  private readonly logger = new Logger(AdapterRegistryService.name);
  private readonly adapters = new Map<AdapterType, AdapterRegistration>();
  private activeAdapter: IBrowserAdapter | null = null;

  /**
   * Register a browser adapter
   * @param registration Adapter registration info
   */
  registerAdapter(registration: AdapterRegistration): void {
    const { type } = registration.metadata;

    if (this.adapters.has(type)) {
      this.logger.warn(`Adapter '${type}' is already registered, overwriting`);
    }

    this.adapters.set(type, registration);
    this.logger.log(
      `Registered adapter: ${registration.metadata.name} (${type})`,
    );
  }

  /**
   * Unregister a browser adapter
   * @param type Adapter type to unregister
   */
  unregisterAdapter(type: AdapterType): boolean {
    const removed = this.adapters.delete(type);
    if (removed) {
      this.logger.log(`Unregistered adapter: ${type}`);
    }
    return removed;
  }

  /**
   * Get all registered adapters
   */
  getRegisteredAdapters(): AdapterMetadata[] {
    return Array.from(this.adapters.values()).map((reg) => reg.metadata);
  }

  /**
   * Check if an adapter type is registered
   * @param type Adapter type to check
   */
  hasAdapter(type: AdapterType): boolean {
    return this.adapters.has(type);
  }

  /**
   * Get adapter metadata by type
   * @param type Adapter type
   */
  getAdapterMetadata(type: AdapterType): AdapterMetadata | undefined {
    return this.adapters.get(type)?.metadata;
  }

  /**
   * Create an adapter instance by type
   * @param type Adapter type
   * @returns New adapter instance
   */
  createAdapter(type: AdapterType): IBrowserAdapter {
    const registration = this.adapters.get(type);

    if (!registration) {
      const available = Array.from(this.adapters.keys()).join(', ');
      throw new Error(
        `Unknown adapter type: '${type}'. Available adapters: ${available || 'none'}`,
      );
    }

    this.logger.debug(`Creating adapter instance: ${type}`);
    return registration.factory();
  }

  /**
   * Auto-detect the best adapter based on browser information
   * @param options Detection options
   * @returns Detection result with adapter type and confidence
   */
  detectAdapter(options: AdapterSelectionOptions): AdapterDetectionResult {
    const { browserPath, browserName } = options;

    // Check browser path patterns
    if (browserPath) {
      const pathLower = browserPath.toLowerCase();

      // Check each registered adapter's browser patterns
      const matchingAdapters: Array<{
        type: AdapterType;
        priority: number;
        pattern: string;
      }> = [];

      for (const [type, registration] of this.adapters) {
        const { browserPatterns, priority = 0 } = registration.metadata;

        if (browserPatterns) {
          for (const pattern of browserPatterns) {
            if (pattern.test(pathLower)) {
              matchingAdapters.push({
                type,
                priority,
                pattern: pattern.source,
              });
              break;
            }
          }
        }
      }

      // Sort by priority (highest first) and return best match
      if (matchingAdapters.length > 0) {
        matchingAdapters.sort((a, b) => b.priority - a.priority);
        const best = matchingAdapters[0]!;

        return {
          adapterType: best.type,
          confidence: 'high',
          reason: `Browser path matches pattern: ${best.pattern}`,
        };
      }
    }

    // Check browser name hint
    if (browserName) {
      const nameLower = browserName.toLowerCase();

      // Common browser name mappings
      const browserMappings: Record<string, AdapterType> = {
        chrome: 'chromium-cdp',
        chromium: 'chromium-cdp',
        edge: 'chromium-cdp',
        brave: 'chromium-cdp',
        arc: 'chromium-cdp',
        dia: 'chromium-cdp',
        zen: 'chromium-cdp',
        safari: 'webkit-native',
        webkit: 'webkit-native',
        firefox: 'firefox-rdp',
      };

      for (const [name, type] of Object.entries(browserMappings)) {
        if (nameLower.includes(name) && this.adapters.has(type)) {
          return {
            adapterType: type,
            confidence: 'medium',
            reason: `Browser name '${browserName}' suggests ${type}`,
          };
        }
      }
    }

    // Default to chromium-cdp if available
    if (this.adapters.has('chromium-cdp')) {
      return {
        adapterType: 'chromium-cdp',
        confidence: 'low',
        reason: 'Defaulting to chromium-cdp adapter',
      };
    }

    // Return first available adapter
    const firstAdapter = this.adapters.keys().next().value;
    if (firstAdapter) {
      return {
        adapterType: firstAdapter,
        confidence: 'low',
        reason: `Using first available adapter: ${firstAdapter}`,
      };
    }

    throw new Error('No adapters registered. Cannot auto-detect adapter.');
  }

  /**
   * Select and create an adapter based on options
   * Supports explicit selection via --adapter flag or auto-detection
   *
   * @param options Selection options
   * @returns Created adapter instance
   */
  selectAdapter(options: AdapterSelectionOptions): IBrowserAdapter {
    let adapterType: AdapterType;

    if (options.adapterType) {
      // Explicit adapter selection
      if (!this.hasAdapter(options.adapterType)) {
        const available = Array.from(this.adapters.keys()).join(', ');
        throw new Error(
          `Specified adapter '${options.adapterType}' is not registered. ` +
            `Available adapters: ${available || 'none'}`,
        );
      }
      adapterType = options.adapterType;
      this.logger.log(`Using explicitly specified adapter: ${adapterType}`);
    } else {
      // Auto-detect adapter
      const detection = this.detectAdapter(options);
      adapterType = detection.adapterType;
      this.logger.log(
        `Auto-detected adapter: ${adapterType} (${detection.confidence} confidence) - ${detection.reason}`,
      );
    }

    return this.createAdapter(adapterType);
  }

  /**
   * Get or create the active adapter
   * Reuses existing adapter if already connected
   *
   * @param options Selection options
   * @returns Active adapter instance
   */
  async getActiveAdapter(
    options: AdapterSelectionOptions & AdapterConnectionOptions,
  ): Promise<IBrowserAdapter> {
    // If we have an active adapter of the right type, reuse it
    if (this.activeAdapter) {
      const currentType = this.activeAdapter.metadata.type;
      const requestedType = options.adapterType;

      if (!requestedType || currentType === requestedType) {
        if (this.activeAdapter.isConnected()) {
          this.logger.debug(`Reusing active adapter: ${currentType}`);
          return this.activeAdapter;
        }
      } else {
        // Different adapter requested, disconnect current
        await this.disconnectActiveAdapter();
      }
    }

    // Create and connect new adapter
    const adapter = this.selectAdapter(options);

    try {
      await adapter.connect(options);
      this.activeAdapter = adapter;
      return adapter;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to connect adapter: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Disconnect the active adapter
   */
  async disconnectActiveAdapter(): Promise<void> {
    if (this.activeAdapter) {
      try {
        if (this.activeAdapter.isConnected()) {
          await this.activeAdapter.disconnect();
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(`Error disconnecting adapter: ${errorMessage}`);
      }
      this.activeAdapter = null;
    }
  }

  /**
   * Get the currently active adapter (if any)
   */
  getActiveAdapterInstance(): IBrowserAdapter | null {
    return this.activeAdapter;
  }

  /**
   * List all registered adapter types
   */
  listAdapterTypes(): AdapterType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get adapter capabilities summary
   */
  getCapabilitiesSummary(): Record<AdapterType, string[]> {
    const summary: Record<string, string[]> = {};

    for (const [type, registration] of this.adapters) {
      summary[type] = registration.metadata.capabilities;
    }

    return summary as Record<AdapterType, string[]>;
  }
}
