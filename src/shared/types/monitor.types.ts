/**
 * Monitor types for continuous performance monitoring
 */

import type { Severity } from './detection.types.js';

export interface WindowMetrics {
  avgFps: number;
  droppedFramesPct: number;
  p95FrameTime: number;
  samples: number;
}

export interface RollingMetrics {
  windows: {
    '1m': WindowMetrics;
    '5m': WindowMetrics;
    '15m': WindowMetrics;
  };
  violations: Violation[];
}

export interface Violation {
  ruleId: string;
  ruleName: string;
  severity: Severity;
  actualValue: number;
  threshold: number;
  timestamp: Date;
}

export interface MonitorOptions {
  url: string;
  scenario: string;
  rollingWindowSeconds: number;
  alertCmd?: string;
}

export type ViolationHandler = (violation: Violation) => void;
