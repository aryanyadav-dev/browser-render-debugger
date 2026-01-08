import { Injectable } from '@nestjs/common';

/**
 * Configuration for sampling controls
 */
export interface SamplingConfig {
  /** Sampling rate (0.0 to 1.0, where 1.0 = 100% sampling) */
  samplingRate: number;
  /** Enable admin-only trigger mode */
  adminTriggerOnly: boolean;
  /** Admin token for trigger mode (if adminTriggerOnly is true) */
  adminToken?: string;
}

/**
 * Default sampling configuration
 */
export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  samplingRate: 1.0, // 100% in development
  adminTriggerOnly: false,
  adminToken: undefined,
};

/**
 * Result of a sampling decision
 */
export interface SamplingDecision {
  /** Whether to proceed with sampling */
  shouldSample: boolean;
  /** Reason for the decision */
  reason: string;
  /** The random value used for probabilistic sampling (for debugging) */
  randomValue?: number;
}

/**
 * Service for managing sampling controls in production environments
 * Supports probabilistic sampling and admin-only trigger modes
 */
@Injectable()
export class SamplingService {
  private config: SamplingConfig;
  private sampleCount = 0;
  private skipCount = 0;

  constructor() {
    this.config = { ...DEFAULT_SAMPLING_CONFIG };
  }

  /**
   * Configure sampling settings
   */
  configure(config: Partial<SamplingConfig>): void {
    // Validate and clamp sampling rate to 0.0-1.0 range
    if (config.samplingRate !== undefined) {
      config.samplingRate = Math.max(0.0, Math.min(1.0, config.samplingRate));
    }

    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SamplingConfig {
    return { ...this.config };
  }

  /**
   * Make a sampling decision based on current configuration
   * @param adminToken Optional admin token for admin-only mode
   */
  shouldSample(adminToken?: string): SamplingDecision {
    // Check admin-only mode first
    if (this.config.adminTriggerOnly) {
      if (!adminToken) {
        this.skipCount++;
        return {
          shouldSample: false,
          reason: 'Admin trigger mode enabled but no admin token provided',
        };
      }

      if (this.config.adminToken && adminToken !== this.config.adminToken) {
        this.skipCount++;
        return {
          shouldSample: false,
          reason: 'Invalid admin token',
        };
      }

      // Admin token valid, proceed with sampling rate check
    }

    // Probabilistic sampling
    if (this.config.samplingRate <= 0) {
      this.skipCount++;
      return {
        shouldSample: false,
        reason: 'Sampling rate is 0%',
        randomValue: 0,
      };
    }

    if (this.config.samplingRate >= 1.0) {
      this.sampleCount++;
      return {
        shouldSample: true,
        reason: 'Sampling rate is 100%',
        randomValue: 1,
      };
    }

    // Generate random value for probabilistic sampling
    const randomValue = Math.random();
    const shouldSample = randomValue < this.config.samplingRate;

    if (shouldSample) {
      this.sampleCount++;
      return {
        shouldSample: true,
        reason: `Probabilistic sampling (${(this.config.samplingRate * 100).toFixed(1)}% rate)`,
        randomValue,
      };
    } else {
      this.skipCount++;
      return {
        shouldSample: false,
        reason: `Skipped by probabilistic sampling (${(this.config.samplingRate * 100).toFixed(1)}% rate)`,
        randomValue,
      };
    }
  }

  /**
   * Get sampling statistics
   */
  getStats(): {
    sampleCount: number;
    skipCount: number;
    totalCount: number;
    actualRate: number;
  } {
    const totalCount = this.sampleCount + this.skipCount;
    const actualRate = totalCount > 0 ? this.sampleCount / totalCount : 0;

    return {
      sampleCount: this.sampleCount,
      skipCount: this.skipCount,
      totalCount,
      actualRate,
    };
  }

  /**
   * Reset sampling statistics
   */
  resetStats(): void {
    this.sampleCount = 0;
    this.skipCount = 0;
  }

  /**
   * Validate a sampling rate value
   */
  validateSamplingRate(rate: number): {
    valid: boolean;
    clampedValue: number;
    message?: string;
  } {
    if (rate < 0) {
      return {
        valid: false,
        clampedValue: 0,
        message: 'Sampling rate cannot be negative. Using 0%.',
      };
    }

    if (rate > 1) {
      return {
        valid: false,
        clampedValue: 1,
        message: 'Sampling rate cannot exceed 1.0 (100%). Using 100%.',
      };
    }

    return { valid: true, clampedValue: rate };
  }

  /**
   * Check if admin trigger mode is enabled
   */
  isAdminTriggerMode(): boolean {
    return this.config.adminTriggerOnly;
  }

  /**
   * Enable admin-only trigger mode
   */
  enableAdminTriggerMode(adminToken?: string): void {
    this.config.adminTriggerOnly = true;
    if (adminToken) {
      this.config.adminToken = adminToken;
    }
  }

  /**
   * Disable admin-only trigger mode
   */
  disableAdminTriggerMode(): void {
    this.config.adminTriggerOnly = false;
    this.config.adminToken = undefined;
  }

  /**
   * Set sampling rate
   */
  setSamplingRate(rate: number): void {
    const validation = this.validateSamplingRate(rate);
    this.config.samplingRate = validation.clampedValue;
  }

  /**
   * Get current sampling rate
   */
  getSamplingRate(): number {
    return this.config.samplingRate;
  }

  /**
   * Get a human-readable description of current sampling configuration
   */
  getConfigDescription(): string {
    const parts: string[] = [];

    parts.push(
      `Sampling rate: ${(this.config.samplingRate * 100).toFixed(1)}%`,
    );

    if (this.config.adminTriggerOnly) {
      parts.push('Admin trigger mode: enabled');
      if (this.config.adminToken) {
        parts.push('Admin token: configured');
      }
    }

    return parts.join(', ');
  }
}
