/**
 * JSON Reporter
 * Generates machine-readable JSON reports conforming to TraceSummary schema
 *
 * Requirements: 3.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { Injectable } from '@nestjs/common';
import type {
  Detection,
  LayoutThrashDetection,
  GPUStallDetection,
  LongTaskDetection,
  HeavyPaintDetection,
} from '../shared/types/index.js';
import type { Suggestion } from '../shared/types/suggestion.types.js';
import type { AnalysisReport, JSONReportOptions } from './interfaces/index.js';

/**
 * Extended JSON report with full detection and suggestion details
 */
export interface JSONReport {
  /** Unique report identifier */
  id: string;
  /** Report name/title */
  name: string;
  /** Profiled URL */
  url: string;
  /** Profile duration in milliseconds */
  duration_ms: number;
  /** Frame metrics */
  frames: {
    total: number;
    dropped: number;
    avg_fps: number;
    frame_budget_ms: number;
  };
  /** Rendering phase breakdown */
  phase_breakdown: {
    style_recalc_ms: number;
    layout_ms: number;
    paint_ms: number;
    composite_ms: number;
    gpu_ms: number;
  };
  /** Performance hotspots */
  hotspots: {
    layout_thrashing: LayoutThrashingHotspotJSON[];
    gpu_stalls: GPUStallHotspotJSON[];
    long_tasks: LongTaskHotspotJSON[];
    heavy_paints: HeavyPaintHotspotJSON[];
  };
  /** All detections with full details */
  detections: DetectionJSON[];
  /** Fix suggestions */
  suggestions: SuggestionJSON[];
  /** Report metadata */
  metadata: {
    browser_version: string;
    user_agent: string;
    viewport: { width: number; height: number };
    device_pixel_ratio: number;
    timestamp: string;
    scenario: string;
    fps_target: number;
    report_generated_at: string;
    render_debugger_version: string;
  };
  /** Summary statistics */
  summary: {
    total_issues: number;
    critical_issues: number;
    high_issues: number;
    warning_issues: number;
    info_issues: number;
    total_suggestions: number;
    estimated_total_speedup_pct: number;
  };
}

interface LayoutThrashingHotspotJSON {
  selector: string;
  reflow_cost_ms: number;
  occurrences: number;
  affected_nodes: number;
}

interface GPUStallHotspotJSON {
  element: string;
  stall_ms: number;
  occurrences: number;
  stall_type?: string;
}

interface LongTaskHotspotJSON {
  function: string;
  file: string;
  line: number;
  cpu_ms: number;
  occurrences: number;
  correlated_frame_drops?: number;
}

interface HeavyPaintHotspotJSON {
  paint_time_ms: number;
  raster_time_ms: number;
  layer_count: number;
  occurrences: number;
}

interface DetectionJSON {
  type: string;
  severity: string;
  description: string;
  location: {
    file?: string;
    line?: number;
    column?: number;
    selector?: string;
    element?: string;
  };
  metrics: {
    duration_ms: number;
    occurrences: number;
    impact_score: number;
    confidence?: string;
    estimated_speedup_pct?: number;
    frame_budget_impact_pct?: number;
  };
  details: Record<string, unknown>;
}

interface SuggestionJSON {
  id: string;
  type: 'css' | 'js' | 'native';
  target: string;
  description: string;
  patch: string;
  estimated_speedup_pct: number;
  speedup_explanation: string;
  confidence: string;
  warnings: string[];
  affected_files: string[];
}

@Injectable()
export class JSONReporter {
  private readonly version = '1.0.0';

  /**
   * Generate JSON report from analysis result
   */
  generate(report: AnalysisReport, options: JSONReportOptions = {}): string {
    const { prettyPrint = true, indent = 2 } = options;

    const jsonReport = this.buildJSONReport(report);

    return prettyPrint
      ? JSON.stringify(jsonReport, null, indent)
      : JSON.stringify(jsonReport);
  }

  /**
   * Build the complete JSON report object
   */
  private buildJSONReport(report: AnalysisReport): JSONReport {
    const { summary, detections, suggestions } = report;

    return {
      id: summary.id,
      name: summary.name,
      url: summary.url,
      duration_ms: summary.duration_ms,
      frames: {
        total: summary.frames.total,
        dropped: summary.frames.dropped,
        avg_fps: summary.frames.avg_fps,
        frame_budget_ms: summary.frames.frame_budget_ms,
      },
      phase_breakdown: {
        style_recalc_ms: summary.phase_breakdown.style_recalc_ms,
        layout_ms: summary.phase_breakdown.layout_ms,
        paint_ms: summary.phase_breakdown.paint_ms,
        composite_ms: summary.phase_breakdown.composite_ms,
        gpu_ms: summary.phase_breakdown.gpu_ms,
      },
      hotspots: this.buildHotspots(detections),
      detections: this.buildDetections(detections),
      suggestions: this.buildSuggestions(suggestions),
      metadata: {
        ...summary.metadata,
        report_generated_at: new Date().toISOString(),
        render_debugger_version: this.version,
      },
      summary: this.buildSummaryStats(detections, suggestions),
    };
  }

  /**
   * Build hotspots from detections
   */
  private buildHotspots(detections: Detection[]): JSONReport['hotspots'] {
    const layoutThrashing: LayoutThrashingHotspotJSON[] = [];
    const gpuStalls: GPUStallHotspotJSON[] = [];
    const longTasks: LongTaskHotspotJSON[] = [];
    const heavyPaints: HeavyPaintHotspotJSON[] = [];

    for (const detection of detections) {
      switch (detection.type) {
        case 'layout_thrashing': {
          const d = detection as LayoutThrashDetection;
          layoutThrashing.push({
            selector: d.selector,
            reflow_cost_ms: d.reflowCostMs,
            occurrences: d.occurrences,
            affected_nodes: d.affectedNodes,
          });
          break;
        }
        case 'gpu_stall': {
          const d = detection as GPUStallDetection;
          gpuStalls.push({
            element: d.element,
            stall_ms: d.stallMs,
            occurrences: d.occurrences,
            stall_type: d.stallType,
          });
          break;
        }
        case 'long_task': {
          const d = detection as LongTaskDetection;
          longTasks.push({
            function: d.functionName,
            file: d.file,
            line: d.line,
            cpu_ms: d.cpuMs,
            occurrences: d.occurrences,
            correlated_frame_drops: d.correlatedFrameDrops,
          });
          break;
        }
        case 'heavy_paint': {
          const d = detection as HeavyPaintDetection;
          heavyPaints.push({
            paint_time_ms: d.paintTimeMs,
            raster_time_ms: d.rasterTimeMs,
            layer_count: d.layerCount,
            occurrences: d.metrics.occurrences,
          });
          break;
        }
      }
    }

    return {
      layout_thrashing: layoutThrashing,
      gpu_stalls: gpuStalls,
      long_tasks: longTasks,
      heavy_paints: heavyPaints,
    };
  }

  /**
   * Build detection array with full details
   */
  private buildDetections(detections: Detection[]): DetectionJSON[] {
    return detections.map((d) => ({
      type: d.type,
      severity: d.severity,
      description: d.description,
      location: {
        file: d.location.file,
        line: d.location.line,
        column: d.location.column,
        selector: d.location.selector,
        element: d.location.element,
      },
      metrics: {
        duration_ms: d.metrics.durationMs,
        occurrences: d.metrics.occurrences,
        impact_score: d.metrics.impactScore,
        confidence: d.metrics.confidence,
        estimated_speedup_pct: d.metrics.estimatedSpeedupPct,
        frame_budget_impact_pct: d.metrics.frameBudgetImpactPct,
      },
      details: this.extractDetectionDetails(d),
    }));
  }

  /**
   * Extract type-specific detection details
   */
  private extractDetectionDetails(
    detection: Detection,
  ): Record<string, unknown> {
    switch (detection.type) {
      case 'layout_thrashing': {
        const d = detection as LayoutThrashDetection;
        return {
          selector: d.selector,
          reflow_cost_ms: d.reflowCostMs,
          affected_nodes: d.affectedNodes,
          read_write_patterns: d.readWritePattern,
        };
      }
      case 'gpu_stall': {
        const d = detection as GPUStallDetection;
        return {
          element: d.element,
          stall_ms: d.stallMs,
          stall_type: d.stallType,
          layer_info: d.layerInfo,
        };
      }
      case 'long_task': {
        const d = detection as LongTaskDetection;
        return {
          function_name: d.functionName,
          file: d.file,
          line: d.line,
          column: d.column,
          cpu_ms: d.cpuMs,
          correlated_frame_drops: d.correlatedFrameDrops,
          call_stack: d.callStack,
        };
      }
      case 'heavy_paint': {
        const d = detection as HeavyPaintDetection;
        return {
          paint_time_ms: d.paintTimeMs,
          raster_time_ms: d.rasterTimeMs,
          layer_count: d.layerCount,
        };
      }
      default:
        return {};
    }
  }

  /**
   * Build suggestions array
   */
  private buildSuggestions(suggestions: Suggestion[]): SuggestionJSON[] {
    return suggestions.map((s) => ({
      id: s.id,
      type: s.type,
      target: s.target,
      description: s.description,
      patch: s.patch,
      estimated_speedup_pct: s.estimatedSpeedupPct,
      speedup_explanation: s.speedupExplanation,
      confidence: s.confidence,
      warnings: s.warnings,
      affected_files: s.affectedFiles,
    }));
  }

  /**
   * Build summary statistics
   */
  private buildSummaryStats(
    detections: Detection[],
    suggestions: Suggestion[],
  ): JSONReport['summary'] {
    const severityCounts = {
      critical: 0,
      high: 0,
      warning: 0,
      info: 0,
    };

    for (const d of detections) {
      severityCounts[d.severity]++;
    }

    // Calculate total speedup (capped at 80%)
    const totalSpeedup = Math.min(
      suggestions.reduce((sum, s) => sum + s.estimatedSpeedupPct, 0),
      80,
    );

    return {
      total_issues: detections.length,
      critical_issues: severityCounts.critical,
      high_issues: severityCounts.high,
      warning_issues: severityCounts.warning,
      info_issues: severityCounts.info,
      total_suggestions: suggestions.length,
      estimated_total_speedup_pct: Math.round(totalSpeedup * 10) / 10,
    };
  }
}
