/**
 * Configuration types for render-debugger
 */

export interface BrowserConfig {
  path: string;
  defaultHeadless: boolean;
  defaultCdpPort: number;
  launchTimeout: number;
}

export interface ProfilingConfig {
  defaultDuration: number;
  defaultFpsTarget: number;
  traceCategories: string[];
  bufferSize: number;
}

export interface AnalysisConfig {
  longTaskThreshold: number;
  layoutThrashThreshold: number;
  gpuStallThreshold: number;
  maxSuggestions: number;
}

export interface OutputConfig {
  tracesDir: string;
  reportsDir: string;
  patchesDir: string;
}

export interface Config {
  version: string;
  browser: BrowserConfig;
  profiling: ProfilingConfig;
  analysis: AnalysisConfig;
  output: OutputConfig;
}

export type RuleMetric =
  | 'p95_frame_time'
  | 'dropped_frames_pct'
  | 'reflow_cost_ms'
  | 'gpu_stall_ms'
  | 'long_task_ms';

export interface RuleThresholds {
  info?: number;
  warning?: number;
  high?: number;
  critical?: number;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  metric: RuleMetric;
  thresholds: RuleThresholds;
  severity: 'info' | 'warning' | 'high' | 'critical';
  enabled: boolean;
}

export interface RuleSet {
  version: string;
  rules: Rule[];
}
