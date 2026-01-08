/**
 * Monitor module interfaces for continuous performance monitoring
 */

import type {
  WindowMetrics,
  RollingMetrics,
  Violation,
  MonitorOptions,
  ViolationHandler,
} from '../../shared/types/monitor.types.js';

/**
 * Sample data point for frame metrics
 */
export interface FrameSample {
  timestamp: number;
  frameTime: number;
  dropped: boolean;
}

/**
 * Rolling window service interface
 */
export interface IRollingWindowService {
  /**
   * Add a frame sample to the rolling windows
   */
  addSample(sample: FrameSample): void;

  /**
   * Get current metrics for all windows
   */
  getMetrics(): RollingMetrics;

  /**
   * Get metrics for a specific window
   */
  getWindowMetrics(window: '1m' | '5m' | '15m'): WindowMetrics;

  /**
   * Clear all samples and reset windows
   */
  reset(): void;

  /**
   * Add a violation to the tracking list
   */
  addViolation(violation: Violation): void;

  /**
   * Get all recorded violations
   */
  getViolations(): Violation[];

  /**
   * Clear violations
   */
  clearViolations(): void;
}

/**
 * Monitor service interface
 */
export interface IMonitorService {
  /**
   * Start continuous monitoring
   */
  start(options: MonitorOptions): Promise<void>;

  /**
   * Stop monitoring
   */
  stop(): Promise<void>;

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean;

  /**
   * Get current rolling metrics
   */
  getMetrics(): RollingMetrics;

  /**
   * Register a violation handler
   */
  onViolation(handler: ViolationHandler): void;

  /**
   * Remove a violation handler
   */
  offViolation(handler: ViolationHandler): void;
}

// Re-export types for convenience
export type {
  WindowMetrics,
  RollingMetrics,
  Violation,
  MonitorOptions,
  ViolationHandler,
};
