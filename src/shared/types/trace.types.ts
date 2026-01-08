/**
 * Trace data types for Chrome DevTools Protocol tracing
 */

export interface TraceEvent {
  pid: number;
  tid: number;
  ts: number;
  ph: string;
  cat: string;
  name: string;
  args?: Record<string, unknown>;
  dur?: number;
  tdur?: number;
  s?: string;
}

export interface TraceMetadata {
  browser_version: string;
  user_agent: string;
  viewport: { width: number; height: number };
  device_pixel_ratio: number;
  timestamp: string;
  scenario: string;
  fps_target: number;
}

export interface TraceData {
  traceEvents: TraceEvent[];
  metadata: TraceMetadata;
}

export interface FrameMetrics {
  total: number;
  dropped: number;
  avg_fps: number;
  frame_budget_ms: number;
}

export interface PhaseBreakdown {
  style_recalc_ms: number;
  layout_ms: number;
  paint_ms: number;
  composite_ms: number;
  gpu_ms: number;
}

export interface LayoutThrashingHotspot {
  selector: string;
  reflow_cost_ms: number;
  occurrences: number;
  affected_nodes: number;
}

export interface GPUStallHotspot {
  element: string;
  stall_ms: number;
  occurrences: number;
}

export interface LongTaskHotspot {
  function: string;
  file: string;
  line: number;
  cpu_ms: number;
  occurrences: number;
}

export interface Hotspots {
  layout_thrashing: LayoutThrashingHotspot[];
  gpu_stalls: GPUStallHotspot[];
  long_tasks: LongTaskHotspot[];
}

export interface SuggestionSummary {
  type: 'css' | 'js' | 'native';
  target: string;
  patch: string;
  estimated_speedup_pct: number;
}

export interface TraceSummary {
  id: string;
  name: string;
  url: string;
  duration_ms: number;
  frames: FrameMetrics;
  phase_breakdown: PhaseBreakdown;
  hotspots: Hotspots;
  suggestions: SuggestionSummary[];
  metadata: TraceMetadata;
}
