/**
 * Terminal Reporter
 * Generates human-friendly terminal output with emojis and formatting
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

import { Injectable } from '@nestjs/common';
import type {
  TraceSummary,
  Detection,
  Severity,
} from '../shared/types/index.js';
import type { Suggestion } from '../shared/types/suggestion.types.js';
import type {
  AnalysisReport,
  TerminalReportOptions,
} from './interfaces/index.js';

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

/**
 * Severity to color mapping
 */
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: COLORS.red,
  high: COLORS.red,
  warning: COLORS.yellow,
  info: COLORS.cyan,
};

/**
 * Severity to emoji mapping - minimal set
 */
const SEVERITY_EMOJIS: Record<Severity, string> = {
  critical: '●',
  high: '●',
  warning: '⚠',
  info: '✓',
};

/**
 * Detection type to text label mapping - no emojis
 */
const DETECTION_LABELS: Record<string, string> = {
  layout_thrashing: '[Layout]',
  gpu_stall: '[GPU]',
  long_task: '[Task]',
  heavy_paint: '[Paint]',
  forced_reflow: '[Reflow]',
};

@Injectable()
export class TerminalReporter {
  /**
   * Generate terminal report from analysis result
   */
  generate(
    report: AnalysisReport,
    options: TerminalReportOptions = {},
  ): string {
    const { colorize = true, verbose = false } = options;
    const lines: string[] = [];

    // Header
    lines.push(this.generateHeader(report.summary, colorize));
    lines.push('');

    // Frame Performance Section
    lines.push(this.generateFramePerformance(report.summary, colorize));
    lines.push('');

    // Phase Breakdown Section
    lines.push(this.generatePhaseBreakdown(report.summary, colorize));
    lines.push('');

    // Bottleneck Analysis Section
    if (report.detections.length > 0) {
      lines.push(
        this.generateBottleneckAnalysis(
          report.detections,
          report.suggestions,
          colorize,
          verbose,
        ),
      );
      lines.push('');
    }

    // Suggestions Summary
    if (report.suggestions.length > 0) {
      lines.push(this.generateSuggestionsSummary(report.suggestions, colorize));
      lines.push('');
    }

    // Total Potential Improvement
    lines.push(this.generateTotalImprovement(report.suggestions, colorize));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate report header with URL, scenario, duration
   */
  private generateHeader(summary: TraceSummary, colorize: boolean): string {
    const lines: string[] = [];
    const c = colorize ? COLORS : { bold: '', reset: '', cyan: '', dim: '' };

    lines.push(
      `${c.bold}═══════════════════════════════════════════════════════════════${c.reset}`,
    );
    lines.push(`${c.bold}  Render Debugger Analysis Report${c.reset}`);
    lines.push(
      `${c.bold}═══════════════════════════════════════════════════════════════${c.reset}`,
    );
    lines.push('');
    lines.push(`  ${c.cyan}URL:${c.reset}      ${summary.url}`);
    lines.push(`  ${c.cyan}Scenario:${c.reset} ${summary.metadata.scenario}`);
    lines.push(
      `  ${c.cyan}Duration:${c.reset} ${this.formatDuration(summary.duration_ms)}`,
    );
    lines.push(
      `  ${c.cyan}Target:${c.reset}   ${summary.metadata.fps_target} FPS`,
    );

    return lines.join('\n');
  }

  /**
   * Generate frame performance metrics section
   */
  private generateFramePerformance(
    summary: TraceSummary,
    colorize: boolean,
  ): string {
    const lines: string[] = [];
    const c = colorize
      ? COLORS
      : { bold: '', reset: '', green: '', red: '', yellow: '', dim: '' };
    const frames = summary.frames;

    lines.push(`${c.bold}Frame Performance${c.reset}`);
    lines.push(`${'─'.repeat(50)}`);

    // FPS with color based on target
    const fpsColor =
      frames.avg_fps >= summary.metadata.fps_target * 0.9
        ? c.green
        : frames.avg_fps >= summary.metadata.fps_target * 0.7
          ? c.yellow
          : c.red;
    lines.push(
      `  Average FPS:     ${fpsColor}${frames.avg_fps.toFixed(1)}${c.reset} / ${summary.metadata.fps_target}`,
    );

    // Frame time
    const avgFrameTime = frames.avg_fps > 0 ? 1000 / frames.avg_fps : 0;
    const frameTimeColor =
      avgFrameTime <= frames.frame_budget_ms
        ? c.green
        : avgFrameTime <= frames.frame_budget_ms * 1.5
          ? c.yellow
          : c.red;
    lines.push(
      `  Avg Frame Time:  ${frameTimeColor}${avgFrameTime.toFixed(2)}ms${c.reset} / ${frames.frame_budget_ms.toFixed(2)}ms budget`,
    );

    // Total frames
    lines.push(`  Total Frames:    ${frames.total}`);

    // Dropped frames with percentage
    const droppedPct =
      frames.total > 0 ? (frames.dropped / frames.total) * 100 : 0;
    const droppedColor =
      droppedPct <= 5 ? c.green : droppedPct <= 15 ? c.yellow : c.red;
    lines.push(
      `  Dropped Frames:  ${droppedColor}${frames.dropped}${c.reset} (${droppedPct.toFixed(1)}%)`,
    );

    return lines.join('\n');
  }

  /**
   * Generate phase breakdown section
   */
  private generatePhaseBreakdown(
    summary: TraceSummary,
    colorize: boolean,
  ): string {
    const lines: string[] = [];
    const c = colorize ? COLORS : { bold: '', reset: '', dim: '' };
    const pb = summary.phase_breakdown;

    lines.push(`${c.bold}Phase Breakdown${c.reset}`);
    lines.push(`${'─'.repeat(50)}`);

    const phases = [
      { name: 'Style Recalc', value: pb.style_recalc_ms },
      { name: 'Layout', value: pb.layout_ms },
      { name: 'Paint', value: pb.paint_ms },
      { name: 'Composite', value: pb.composite_ms },
      { name: 'GPU', value: pb.gpu_ms },
    ];

    const total = phases.reduce((sum, p) => sum + p.value, 0);

    for (const phase of phases) {
      const pct = total > 0 ? (phase.value / total) * 100 : 0;
      const bar = this.generateProgressBar(pct, 20, colorize);
      lines.push(
        `  ${phase.name.padEnd(14)} ${phase.value.toFixed(2).padStart(8)}ms ${bar} ${pct.toFixed(1)}%`,
      );
    }

    lines.push(`  ${'─'.repeat(46)}`);
    lines.push(
      `  ${c.bold}Total${c.reset}          ${total.toFixed(2).padStart(8)}ms`,
    );

    return lines.join('\n');
  }

  /**
   * Generate bottleneck analysis section with numbered issues
   */
  private generateBottleneckAnalysis(
    detections: Detection[],
    suggestions: Suggestion[],
    colorize: boolean,
    verbose: boolean,
  ): string {
    const lines: string[] = [];
    const c = colorize
      ? COLORS
      : {
          bold: '',
          reset: '',
          dim: '',
          red: '',
          yellow: '',
          cyan: '',
          green: '',
        };

    lines.push(`${c.bold}Bottleneck Analysis${c.reset}`);
    lines.push(`${'─'.repeat(50)}`);

    // Sort detections by severity and impact
    const sortedDetections = [...detections].sort((a, b) => {
      const severityOrder: Record<Severity, number> = {
        critical: 0,
        high: 1,
        warning: 2,
        info: 3,
      };
      const severityDiff =
        severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.metrics.impactScore - a.metrics.impactScore;
    });

    // Limit to top issues unless verbose
    const displayDetections = verbose
      ? sortedDetections
      : sortedDetections.slice(0, 5);

    displayDetections.forEach((detection, index) => {
      const label = DETECTION_LABELS[detection.type] ?? '[Issue]';
      const severityEmoji = SEVERITY_EMOJIS[detection.severity];
      const severityColor = colorize ? SEVERITY_COLORS[detection.severity] : '';

      lines.push('');
      lines.push(
        `  ${c.bold}${index + 1}. ${label} ${this.formatDetectionType(detection.type)}${c.reset} ${severityEmoji}`,
      );
      lines.push(
        `     ${c.dim}Severity: ${severityColor}${detection.severity.toUpperCase()}${c.reset}`,
      );
      lines.push(`     ${detection.description}`);

      // Show affected element/location
      if (detection.location.selector) {
        lines.push(
          `     ${c.cyan}Affected:${c.reset} ${detection.location.selector}`,
        );
      } else if (detection.location.file) {
        const loc = `${detection.location.file}:${detection.location.line ?? '?'}`;
        lines.push(`     ${c.cyan}Location:${c.reset} ${loc}`);
      }

      // Show metrics
      lines.push(
        `     ${c.cyan}Impact:${c.reset} ${detection.metrics.durationMs.toFixed(2)}ms (${detection.metrics.occurrences} occurrences)`,
      );

      // Find matching suggestion
      const suggestion = this.findMatchingSuggestion(detection, suggestions);
      if (suggestion) {
        lines.push(
          `     ${c.green}Fix:${c.reset} ${suggestion.description}`,
        );
        lines.push(
          `     ${c.green}Est. Speedup:${c.reset} ${suggestion.estimatedSpeedupPct}%`,
        );
        if (suggestion.warnings.length > 0 && verbose) {
          for (const warning of suggestion.warnings) {
            lines.push(`     ${c.yellow}⚠  ${warning}${c.reset}`);
          }
        }
      }
    });

    if (!verbose && sortedDetections.length > 5) {
      lines.push('');
      lines.push(
        `  ${c.dim}... and ${sortedDetections.length - 5} more issues (use --verbose to see all)${c.reset}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Generate suggestions summary section
   */
  private generateSuggestionsSummary(
    suggestions: Suggestion[],
    colorize: boolean,
  ): string {
    const lines: string[] = [];
    const c = colorize
      ? COLORS
      : { bold: '', reset: '', green: '', cyan: '', dim: '' };

    lines.push(`${c.bold}Recommended Fixes${c.reset}`);
    lines.push(`${'─'.repeat(50)}`);

    // Group by type
    const cssSuggestions = suggestions.filter((s) => s.type === 'css');
    const jsSuggestions = suggestions.filter((s) => s.type === 'js');

    if (cssSuggestions.length > 0) {
      lines.push(
        `  ${c.cyan}CSS Optimizations (${cssSuggestions.length}):${c.reset}`,
      );
      for (const s of cssSuggestions.slice(0, 3)) {
        lines.push(
          `    - ${s.target}: ${s.description} ${c.green}(+${s.estimatedSpeedupPct}%)${c.reset}`,
        );
      }
      if (cssSuggestions.length > 3) {
        lines.push(
          `    ${c.dim}... and ${cssSuggestions.length - 3} more${c.reset}`,
        );
      }
    }

    if (jsSuggestions.length > 0) {
      lines.push(
        `  ${c.cyan}JavaScript Optimizations (${jsSuggestions.length}):${c.reset}`,
      );
      for (const s of jsSuggestions.slice(0, 3)) {
        lines.push(
          `    - ${s.target}: ${s.description} ${c.green}(+${s.estimatedSpeedupPct}%)${c.reset}`,
        );
      }
      if (jsSuggestions.length > 3) {
        lines.push(
          `    ${c.dim}... and ${jsSuggestions.length - 3} more${c.reset}`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate total potential improvement summary
   */
  private generateTotalImprovement(
    suggestions: Suggestion[],
    colorize: boolean,
  ): string {
    const lines: string[] = [];
    const c = colorize ? COLORS : { bold: '', reset: '', green: '', dim: '' };

    // Calculate total potential improvement (capped at 80%)
    const totalSpeedup = Math.min(
      suggestions.reduce((sum, s) => sum + s.estimatedSpeedupPct, 0),
      80,
    );

    lines.push(
      `${c.bold}═══════════════════════════════════════════════════════════════${c.reset}`,
    );
    lines.push(
      `${c.bold}  Total Potential Improvement: ${c.green}${totalSpeedup.toFixed(1)}%${c.reset}`,
    );
    lines.push(
      `${c.bold}═══════════════════════════════════════════════════════════════${c.reset}`,
    );

    if (suggestions.length > 0) {
      lines.push('');
      lines.push(
        `  ${c.dim}Run \`render-debugger fix <trace.json>\` to generate patches${c.reset}`,
      );
      lines.push(
        `  ${c.dim}Run \`render-debugger fix <trace.json> --auto-apply\` to apply fixes${c.reset}`,
      );
    } else {
      lines.push('');
      lines.push(
        `  ${c.green}✓ No significant performance issues detected!${c.reset}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Generate a progress bar
   */
  private generateProgressBar(
    percentage: number,
    width: number,
    colorize: boolean,
  ): string {
    const c = colorize
      ? COLORS
      : { green: '', yellow: '', red: '', reset: '', dim: '' };
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const color =
      percentage <= 30 ? c.green : percentage <= 60 ? c.yellow : c.red;

    return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Format detection type for display
   */
  private formatDetectionType(type: string): string {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Find a suggestion that matches a detection
   */
  private findMatchingSuggestion(
    detection: Detection,
    suggestions: Suggestion[],
  ): Suggestion | undefined {
    // Match by target location
    return suggestions.find((s) => {
      if (
        detection.location.selector &&
        s.target.includes(detection.location.selector)
      ) {
        return true;
      }
      if (
        detection.location.file &&
        s.affectedFiles.includes(detection.location.file)
      ) {
        return true;
      }
      // Match by detection type to suggestion type
      if (detection.type === 'layout_thrashing' && s.type === 'css') {
        return true;
      }
      if (detection.type === 'long_task' && s.type === 'js') {
        return true;
      }
      return false;
    });
  }
}
