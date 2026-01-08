import { Injectable } from '@nestjs/common';

/**
 * Configuration for privacy and telemetry controls
 */
export interface PrivacyConfig {
  /** Enable/disable telemetry (default: false - no telemetry) */
  telemetryEnabled: boolean;
  /** Enable remote storage (default: false - local only) */
  remoteStorageEnabled: boolean;
  /** Remote storage endpoint (only used if remoteStorageEnabled is true) */
  remoteStorageEndpoint?: string;
  /** Sanitize URLs in traces (remove query params, etc.) */
  sanitizeUrls: boolean;
  /** Sanitize user data in traces */
  sanitizeUserData: boolean;
  /** Patterns to exclude from tracing */
  excludePatterns: string[];
}

/**
 * Default privacy configuration - secure by default
 */
export const DEFAULT_PRIVACY_CONFIG: PrivacyConfig = {
  telemetryEnabled: false,
  remoteStorageEnabled: false,
  remoteStorageEndpoint: undefined,
  sanitizeUrls: false,
  sanitizeUserData: false,
  excludePatterns: [],
};

/**
 * Result of a storage decision
 */
export interface StorageDecision {
  /** Whether to store locally */
  storeLocally: boolean;
  /** Whether to send to remote storage */
  sendRemote: boolean;
  /** Reason for the decision */
  reason: string;
}

/**
 * Result of a telemetry decision
 */
export interface TelemetryDecision {
  /** Whether telemetry is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
}

/**
 * Service for managing privacy controls and enforcing local-only storage
 * by default. No outbound telemetry unless explicitly enabled.
 */
@Injectable()
export class PrivacyService {
  private config: PrivacyConfig;

  constructor() {
    this.config = { ...DEFAULT_PRIVACY_CONFIG };
  }

  /**
   * Configure privacy settings
   */
  configure(config: Partial<PrivacyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): PrivacyConfig {
    return { ...this.config };
  }

  /**
   * Check if telemetry is allowed
   */
  isTelemetryAllowed(): TelemetryDecision {
    if (!this.config.telemetryEnabled) {
      return {
        allowed: false,
        reason: 'Telemetry is disabled by default. Use --telemetry to enable.',
      };
    }

    return {
      allowed: true,
      reason: 'Telemetry explicitly enabled via configuration',
    };
  }

  /**
   * Check if remote storage is allowed
   */
  isRemoteStorageAllowed(): boolean {
    return this.config.remoteStorageEnabled;
  }

  /**
   * Make a storage decision based on current configuration
   */
  getStorageDecision(): StorageDecision {
    const storeLocally = true; // Always store locally
    const sendRemote =
      this.config.remoteStorageEnabled && !!this.config.remoteStorageEndpoint;

    let reason: string;
    if (sendRemote) {
      reason = `Storing locally and sending to remote: ${this.config.remoteStorageEndpoint}`;
    } else if (
      this.config.remoteStorageEnabled &&
      !this.config.remoteStorageEndpoint
    ) {
      reason =
        'Remote storage enabled but no endpoint configured. Storing locally only.';
    } else {
      reason =
        'Local-only storage (default). Use --remote-storage to enable remote.';
    }

    return {
      storeLocally,
      sendRemote,
      reason,
    };
  }

  /**
   * Enable telemetry
   */
  enableTelemetry(): void {
    this.config.telemetryEnabled = true;
  }

  /**
   * Disable telemetry (default)
   */
  disableTelemetry(): void {
    this.config.telemetryEnabled = false;
  }

  /**
   * Enable remote storage
   */
  enableRemoteStorage(endpoint?: string): void {
    this.config.remoteStorageEnabled = true;
    if (endpoint) {
      this.config.remoteStorageEndpoint = endpoint;
    }
  }

  /**
   * Disable remote storage (default)
   */
  disableRemoteStorage(): void {
    this.config.remoteStorageEnabled = false;
    this.config.remoteStorageEndpoint = undefined;
  }

  /**
   * Check if a URL should be excluded from tracing
   */
  shouldExcludeUrl(url: string): boolean {
    return this.config.excludePatterns.some((pattern) => {
      // Support simple glob patterns
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      );
      return regex.test(url);
    });
  }

  /**
   * Sanitize a URL by removing sensitive parts
   */
  sanitizeUrl(url: string): string {
    if (!this.config.sanitizeUrls) {
      return url;
    }

    try {
      const parsed = new URL(url);
      // Remove query parameters
      parsed.search = '';
      // Remove hash
      parsed.hash = '';
      // Remove username/password
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      // If URL parsing fails, return a sanitized version
      return url.split('?')[0]?.split('#')[0] ?? url;
    }
  }

  /**
   * Sanitize trace data by removing potentially sensitive information
   */
  sanitizeTraceData<T extends Record<string, unknown>>(data: T): T {
    if (!this.config.sanitizeUserData) {
      return data;
    }

    const sanitized = { ...data };

    // Remove common sensitive fields
    const sensitiveFields = [
      'cookie',
      'cookies',
      'authorization',
      'auth',
      'token',
      'password',
      'secret',
      'key',
      'apiKey',
      'api_key',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'sessionId',
      'session_id',
      'userId',
      'user_id',
      'email',
      'phone',
      'address',
      'ssn',
      'creditCard',
      'credit_card',
    ];

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        (sanitized as Record<string, unknown>)[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Add an exclude pattern
   */
  addExcludePattern(pattern: string): void {
    if (!this.config.excludePatterns.includes(pattern)) {
      this.config.excludePatterns.push(pattern);
    }
  }

  /**
   * Remove an exclude pattern
   */
  removeExcludePattern(pattern: string): void {
    this.config.excludePatterns = this.config.excludePatterns.filter(
      (p) => p !== pattern,
    );
  }

  /**
   * Get a human-readable description of current privacy configuration
   */
  getConfigDescription(): string {
    const parts: string[] = [];

    parts.push(
      `Telemetry: ${this.config.telemetryEnabled ? 'enabled' : 'disabled (default)'}`,
    );
    parts.push(
      `Remote storage: ${this.config.remoteStorageEnabled ? 'enabled' : 'disabled (default)'}`,
    );

    if (this.config.remoteStorageEnabled && this.config.remoteStorageEndpoint) {
      parts.push(`Remote endpoint: ${this.config.remoteStorageEndpoint}`);
    }

    if (this.config.sanitizeUrls) {
      parts.push('URL sanitization: enabled');
    }

    if (this.config.sanitizeUserData) {
      parts.push('User data sanitization: enabled');
    }

    if (this.config.excludePatterns.length > 0) {
      parts.push(`Exclude patterns: ${this.config.excludePatterns.length}`);
    }

    return parts.join(', ');
  }

  /**
   * Validate that no outbound connections will be made
   */
  assertNoOutboundConnections(): void {
    if (this.config.telemetryEnabled) {
      throw new Error(
        'Telemetry is enabled. Disable with --no-telemetry to ensure no outbound connections.',
      );
    }

    if (this.config.remoteStorageEnabled) {
      throw new Error(
        'Remote storage is enabled. Disable with --no-remote-storage to ensure no outbound connections.',
      );
    }
  }
}
