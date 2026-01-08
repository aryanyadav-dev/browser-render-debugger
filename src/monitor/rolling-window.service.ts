/**
 * Rolling Window Service - Maintains rolling windows of performance metrics
 * Tracks 1m, 5m, and 15m windows for avgFps, droppedFramesPct, and p95FrameTime
 */

import { Injectable } from '@nestjs/common';
import type {
  IRollingWindowService,
  FrameSample,
  WindowMetrics,
  RollingMetrics,
  Violation,
} from './interfaces/monitor.interface.js';

/** Window durations in milliseconds */
const WINDOW_DURATIONS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
} as const;

type WindowKey = keyof typeof WINDOW_DURATIONS;

@Injectable()
export class RollingWindowService implements IRollingWindowService {
  /** All frame samples, sorted by timestamp */
  private samples: FrameSample[] = [];

  /** Recorded violations */
  private violations: Violation[] = [];

  /** Maximum samples to keep (15 minutes at 60fps = 54000 samples) */
  private readonly maxSamples = 60000;

  /**
   * Add a frame sample to the rolling windows
   */
  addSample(sample: FrameSample): void {
    this.samples.push(sample);

    // Prune old samples beyond 15m window
    this.pruneOldSamples();

    // Keep samples array bounded
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }
  }

  /**
   * Get current metrics for all windows
   */
  getMetrics(): RollingMetrics {
    return {
      windows: {
        '1m': this.getWindowMetrics('1m'),
        '5m': this.getWindowMetrics('5m'),
        '15m': this.getWindowMetrics('15m'),
      },
      violations: [...this.violations],
    };
  }

  /**
   * Get metrics for a specific window
   */
  getWindowMetrics(window: WindowKey): WindowMetrics {
    const now = Date.now();
    const windowDuration = WINDOW_DURATIONS[window];
    const cutoff = now - windowDuration;

    // Filter samples within the window
    const windowSamples = this.samples.filter((s) => s.timestamp >= cutoff);

    if (windowSamples.length === 0) {
      return {
        avgFps: 0,
        droppedFramesPct: 0,
        p95FrameTime: 0,
        samples: 0,
      };
    }

    // Calculate metrics
    const frameTimes = windowSamples.map((s) => s.frameTime);
    const droppedCount = windowSamples.filter((s) => s.dropped).length;

    const avgFrameTime =
      frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const avgFps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    const droppedFramesPct = (droppedCount / windowSamples.length) * 100;
    const p95FrameTime = this.calculatePercentile(frameTimes, 95);

    return {
      avgFps: Math.round(avgFps * 10) / 10,
      droppedFramesPct: Math.round(droppedFramesPct * 100) / 100,
      p95FrameTime: Math.round(p95FrameTime * 100) / 100,
      samples: windowSamples.length,
    };
  }

  /**
   * Clear all samples and reset windows
   */
  reset(): void {
    this.samples = [];
    this.violations = [];
  }

  /**
   * Add a violation to the tracking list
   */
  addViolation(violation: Violation): void {
    this.violations.push(violation);
  }

  /**
   * Get all recorded violations
   */
  getViolations(): Violation[] {
    return [...this.violations];
  }

  /**
   * Clear violations
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Remove samples older than 15 minutes
   */
  private pruneOldSamples(): void {
    const cutoff = Date.now() - WINDOW_DURATIONS['15m'];
    this.samples = this.samples.filter((s) => s.timestamp >= cutoff);
  }

  /**
   * Calculate percentile value from an array of numbers
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }
}
