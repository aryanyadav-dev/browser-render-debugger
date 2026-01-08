/**
 * HTML Reporter
 * Generates interactive static HTML reports with embedded CSS/JS
 *
 * Requirements: 3.8
 */

import { Injectable } from '@nestjs/common';
import type {
  TraceSummary,
  Detection,
  Severity,
  LayoutThrashDetection,
  GPUStallDetection,
  LongTaskDetection,
  HeavyPaintDetection,
} from '../shared/types/index.js';
import type { Suggestion } from '../shared/types/suggestion.types.js';
import type { AnalysisReport, HTMLReportOptions } from './interfaces/index.js';

/**
 * Severity to color mapping for HTML
 */
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  warning: '#ca8a04',
  info: '#0284c7',
};

/**
 * Severity to background color mapping
 */
const SEVERITY_BG_COLORS: Record<Severity, string> = {
  critical: '#fef2f2',
  high: '#fff7ed',
  warning: '#fefce8',
  info: '#f0f9ff',
};

@Injectable()
export class HTMLReporter {
  private readonly version = '1.0.0';

  /**
   * Generate HTML report from analysis result
   */
  generate(report: AnalysisReport, options: HTMLReportOptions = {}): string {
    const {
      interactive = true,
      embedAssets = true,
      title = 'Render Debugger Report',
    } = options;

    const { summary, detections, suggestions } = report;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  ${embedAssets ? this.getEmbeddedStyles() : '<link rel="stylesheet" href="styles.css">'}
</head>
<body>
  <div class="container">
    ${this.generateHeader(summary, title)}
    ${this.generateFrameMetrics(summary)}
    ${this.generatePhaseBreakdown(summary)}
    ${this.generateDetections(detections, suggestions, interactive)}
    ${this.generateSuggestions(suggestions)}
    ${this.generateSummary(detections, suggestions)}
    ${this.generateFooter()}
  </div>
  ${embedAssets && interactive ? this.getEmbeddedScripts() : ''}
</body>
</html>`;
  }

  /**
   * Generate embedded CSS styles
   */
  private getEmbeddedStyles(): string {
    return `<style>
:root {
  --primary: #3b82f6;
  --success: #22c55e;
  --warning: #eab308;
  --danger: #ef4444;
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-600: #4b5563;
  --gray-800: #1f2937;
  --gray-900: #111827;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--gray-50);
  color: var(--gray-800);
  line-height: 1.6;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.header {
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  color: white;
  padding: 2rem;
  border-radius: 12px;
  margin-bottom: 2rem;
}

.header h1 {
  font-size: 1.75rem;
  margin-bottom: 1rem;
}

.header-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  font-size: 0.9rem;
  opacity: 0.9;
}

.header-meta-item {
  display: flex;
  flex-direction: column;
}

.header-meta-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  opacity: 0.7;
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.card-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.metric-card {
  background: var(--gray-50);
  padding: 1rem;
  border-radius: 8px;
  text-align: center;
}

.metric-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--primary);
}

.metric-value.good { color: var(--success); }
.metric-value.warning { color: var(--warning); }
.metric-value.bad { color: var(--danger); }

.metric-label {
  font-size: 0.85rem;
  color: var(--gray-600);
  margin-top: 0.25rem;
}

.phase-bar {
  display: flex;
  height: 24px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.phase-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: white;
  font-weight: 500;
  min-width: 40px;
}

.phase-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: 0.85rem;
}

.phase-legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.phase-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.detection-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detection-item {
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  overflow: hidden;
}

.detection-header {
  padding: 1rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background 0.2s;
}

.detection-header:hover {
  background: var(--gray-50);
}

.detection-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.detection-type {
  font-weight: 600;
}

.severity-badge {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.detection-metrics {
  display: flex;
  gap: 1rem;
  font-size: 0.85rem;
  color: var(--gray-600);
}

.detection-body {
  padding: 1rem;
  border-top: 1px solid var(--gray-200);
  background: var(--gray-50);
  display: none;
}

.detection-body.open {
  display: block;
}

.detection-detail {
  margin-bottom: 0.75rem;
}

.detection-detail-label {
  font-weight: 500;
  color: var(--gray-600);
  font-size: 0.85rem;
}

.suggestion-card {
  border-left: 4px solid var(--success);
  background: #f0fdf4;
  padding: 1rem;
  margin-top: 1rem;
  border-radius: 0 8px 8px 0;
}

.suggestion-title {
  font-weight: 600;
  color: #166534;
  margin-bottom: 0.5rem;
}

.suggestion-speedup {
  color: var(--success);
  font-weight: 600;
}

.code-block {
  background: var(--gray-800);
  color: #e5e7eb;
  padding: 1rem;
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 0.85rem;
  overflow-x: auto;
  margin-top: 0.5rem;
}

.summary-card {
  background: linear-gradient(135deg, #166534 0%, #22c55e 100%);
  color: white;
  text-align: center;
  padding: 2rem;
}

.summary-value {
  font-size: 3rem;
  font-weight: 700;
}

.summary-label {
  font-size: 1.1rem;
  opacity: 0.9;
}

.footer {
  text-align: center;
  padding: 1rem;
  color: var(--gray-600);
  font-size: 0.85rem;
}

.expand-icon {
  transition: transform 0.2s;
}

.expand-icon.open {
  transform: rotate(180deg);
}

.warning-badge {
  background: #fef3c7;
  color: #92400e;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin-left: 0.5rem;
}
</style>`;
  }

  /**
   * Generate embedded JavaScript for interactivity
   */
  private getEmbeddedScripts(): string {
    return `<script>
document.addEventListener('DOMContentLoaded', function() {
  // Toggle detection details
  document.querySelectorAll('.detection-header').forEach(function(header) {
    header.addEventListener('click', function() {
      const body = this.nextElementSibling;
      const icon = this.querySelector('.expand-icon');
      body.classList.toggle('open');
      icon.classList.toggle('open');
    });
  });
});
</script>`;
  }

  /**
   * Generate header section
   */
  private generateHeader(summary: TraceSummary, title: string): string {
    return `
    <div class="header">
      <h1>🔍 ${this.escapeHtml(title)}</h1>
      <div class="header-meta">
        <div class="header-meta-item">
          <span class="header-meta-label">URL</span>
          <span>${this.escapeHtml(summary.url)}</span>
        </div>
        <div class="header-meta-item">
          <span class="header-meta-label">Scenario</span>
          <span>${this.escapeHtml(summary.metadata.scenario)}</span>
        </div>
        <div class="header-meta-item">
          <span class="header-meta-label">Duration</span>
          <span>${this.formatDuration(summary.duration_ms)}</span>
        </div>
        <div class="header-meta-item">
          <span class="header-meta-label">Target FPS</span>
          <span>${summary.metadata.fps_target}</span>
        </div>
        <div class="header-meta-item">
          <span class="header-meta-label">Generated</span>
          <span>${new Date().toLocaleString()}</span>
        </div>
      </div>
    </div>`;
  }

  /**
   * Generate frame metrics section
   */
  private generateFrameMetrics(summary: TraceSummary): string {
    const frames = summary.frames;
    const droppedPct =
      frames.total > 0 ? (frames.dropped / frames.total) * 100 : 0;
    const avgFrameTime = frames.avg_fps > 0 ? 1000 / frames.avg_fps : 0;

    const fpsClass =
      frames.avg_fps >= summary.metadata.fps_target * 0.9
        ? 'good'
        : frames.avg_fps >= summary.metadata.fps_target * 0.7
          ? 'warning'
          : 'bad';
    const droppedClass =
      droppedPct <= 5 ? 'good' : droppedPct <= 15 ? 'warning' : 'bad';

    return `
    <div class="card">
      <h2 class="card-title">📊 Frame Performance</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value ${fpsClass}">${frames.avg_fps.toFixed(1)}</div>
          <div class="metric-label">Average FPS</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${avgFrameTime.toFixed(2)}ms</div>
          <div class="metric-label">Avg Frame Time</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${frames.total}</div>
          <div class="metric-label">Total Frames</div>
        </div>
        <div class="metric-card">
          <div class="metric-value ${droppedClass}">${frames.dropped}</div>
          <div class="metric-label">Dropped (${droppedPct.toFixed(1)}%)</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${frames.frame_budget_ms.toFixed(2)}ms</div>
          <div class="metric-label">Frame Budget</div>
        </div>
      </div>
    </div>`;
  }

  /**
   * Generate phase breakdown section with visual bar
   */
  private generatePhaseBreakdown(summary: TraceSummary): string {
    const pb = summary.phase_breakdown;
    const phases = [
      { name: 'Style', value: pb.style_recalc_ms, color: '#8b5cf6' },
      { name: 'Layout', value: pb.layout_ms, color: '#3b82f6' },
      { name: 'Paint', value: pb.paint_ms, color: '#22c55e' },
      { name: 'Composite', value: pb.composite_ms, color: '#eab308' },
      { name: 'GPU', value: pb.gpu_ms, color: '#ef4444' },
    ];

    const total = phases.reduce((sum, p) => sum + p.value, 0);

    const barSegments = phases
      .filter((p) => p.value > 0)
      .map((p) => {
        const pct = total > 0 ? (p.value / total) * 100 : 0;
        return `<div class="phase-segment" style="width: ${pct}%; background: ${p.color};" title="${p.name}: ${p.value.toFixed(2)}ms">${pct > 10 ? p.name : ''}</div>`;
      })
      .join('');

    const legendItems = phases
      .map(
        (p) => `
        <div class="phase-legend-item">
          <div class="phase-dot" style="background: ${p.color};"></div>
          <span>${p.name}: ${p.value.toFixed(2)}ms</span>
        </div>
      `,
      )
      .join('');

    return `
    <div class="card">
      <h2 class="card-title">⏱️ Phase Breakdown</h2>
      <div class="phase-bar">${barSegments}</div>
      <div class="phase-legend">${legendItems}</div>
      <div style="margin-top: 1rem; font-weight: 600;">Total: ${total.toFixed(2)}ms</div>
    </div>`;
  }

  /**
   * Generate detections section with expandable details
   */
  private generateDetections(
    detections: Detection[],
    suggestions: Suggestion[],
    interactive: boolean,
  ): string {
    if (detections.length === 0) {
      return `
      <div class="card">
        <h2 class="card-title">🔥 Bottleneck Analysis</h2>
        <p style="color: var(--success);">✅ No significant performance issues detected!</p>
      </div>`;
    }

    // Sort by severity and impact
    const sorted = [...detections].sort((a, b) => {
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

    const items = sorted
      .map((d, i) =>
        this.generateDetectionItem(d, i + 1, suggestions, interactive),
      )
      .join('');

    return `
    <div class="card">
      <h2 class="card-title">🔥 Bottleneck Analysis (${detections.length} issues)</h2>
      <div class="detection-list">${items}</div>
    </div>`;
  }

  /**
   * Generate a single detection item
   */
  private generateDetectionItem(
    detection: Detection,
    index: number,
    suggestions: Suggestion[],
    interactive: boolean,
  ): string {
    const severityColor = SEVERITY_COLORS[detection.severity];
    const severityBg = SEVERITY_BG_COLORS[detection.severity];
    const emoji = this.getDetectionEmoji(detection.type);

    const suggestion = this.findMatchingSuggestion(detection, suggestions);
    const suggestionHtml = suggestion
      ? this.generateSuggestionCard(suggestion)
      : '';

    const detailsHtml = this.generateDetectionDetails(detection);

    return `
    <div class="detection-item" style="border-left: 4px solid ${severityColor};">
      <div class="detection-header" style="background: ${severityBg};">
        <div class="detection-title">
          <span>${emoji}</span>
          <span class="detection-type">${index}. ${this.formatDetectionType(detection.type)}</span>
          <span class="severity-badge" style="background: ${severityColor}; color: white;">${detection.severity}</span>
        </div>
        <div class="detection-metrics">
          <span>${detection.metrics.durationMs.toFixed(2)}ms</span>
          <span>${detection.metrics.occurrences}x</span>
          ${interactive ? '<span class="expand-icon">▼</span>' : ''}
        </div>
      </div>
      <div class="detection-body${interactive ? '' : ' open'}">
        <p style="margin-bottom: 1rem;">${this.escapeHtml(detection.description)}</p>
        ${detailsHtml}
        ${suggestionHtml}
      </div>
    </div>`;
  }

  /**
   * Generate detection-specific details
   */
  private generateDetectionDetails(detection: Detection): string {
    const details: string[] = [];

    if (detection.location.selector) {
      details.push(
        `<div class="detection-detail"><span class="detection-detail-label">Selector:</span> <code>${this.escapeHtml(detection.location.selector)}</code></div>`,
      );
    }
    if (detection.location.file) {
      const loc = `${detection.location.file}:${detection.location.line ?? '?'}:${detection.location.column ?? '?'}`;
      details.push(
        `<div class="detection-detail"><span class="detection-detail-label">Location:</span> <code>${this.escapeHtml(loc)}</code></div>`,
      );
    }

    // Type-specific details
    switch (detection.type) {
      case 'layout_thrashing': {
        const d = detection as LayoutThrashDetection;
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Reflow Cost:</span> ${d.reflowCostMs.toFixed(2)}ms</div>`,
        );
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Affected Nodes:</span> ${d.affectedNodes}</div>`,
        );
        break;
      }
      case 'gpu_stall': {
        const d = detection as GPUStallDetection;
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Stall Type:</span> ${d.stallType}</div>`,
        );
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Stall Duration:</span> ${d.stallMs.toFixed(2)}ms</div>`,
        );
        break;
      }
      case 'long_task': {
        const d = detection as LongTaskDetection;
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Function:</span> <code>${this.escapeHtml(d.functionName)}</code></div>`,
        );
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">CPU Time:</span> ${d.cpuMs.toFixed(2)}ms</div>`,
        );
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Frame Drops:</span> ${d.correlatedFrameDrops}</div>`,
        );
        break;
      }
      case 'heavy_paint': {
        const d = detection as HeavyPaintDetection;
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Paint Time:</span> ${d.paintTimeMs.toFixed(2)}ms</div>`,
        );
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Raster Time:</span> ${d.rasterTimeMs.toFixed(2)}ms</div>`,
        );
        details.push(
          `<div class="detection-detail"><span class="detection-detail-label">Layers:</span> ${d.layerCount}</div>`,
        );
        break;
      }
    }

    return details.join('');
  }

  /**
   * Generate suggestion card
   */
  private generateSuggestionCard(suggestion: Suggestion): string {
    const warnings =
      suggestion.warnings.length > 0
        ? suggestion.warnings
            .map(
              (w) =>
                `<span class="warning-badge">⚠️ ${this.escapeHtml(w)}</span>`,
            )
            .join('')
        : '';

    return `
    <div class="suggestion-card">
      <div class="suggestion-title">💡 Recommended Fix ${warnings}</div>
      <p>${this.escapeHtml(suggestion.description)}</p>
      <p><span class="suggestion-speedup">📈 Estimated Speedup: +${suggestion.estimatedSpeedupPct}%</span></p>
      <p style="font-size: 0.85rem; color: var(--gray-600);">${this.escapeHtml(suggestion.speedupExplanation)}</p>
      ${suggestion.patch ? `<div class="code-block">${this.escapeHtml(suggestion.patch)}</div>` : ''}
    </div>`;
  }

  /**
   * Generate suggestions summary section
   */
  private generateSuggestions(suggestions: Suggestion[]): string {
    if (suggestions.length === 0) return '';

    const cssSuggestions = suggestions.filter((s) => s.type === 'css');
    const jsSuggestions = suggestions.filter((s) => s.type === 'js');

    return `
    <div class="card">
      <h2 class="card-title">💡 All Recommendations</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value">${cssSuggestions.length}</div>
          <div class="metric-label">CSS Optimizations</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${jsSuggestions.length}</div>
          <div class="metric-label">JS Optimizations</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${suggestions.length}</div>
          <div class="metric-label">Total Suggestions</div>
        </div>
      </div>
    </div>`;
  }

  /**
   * Generate summary section with total improvement
   */
  private generateSummary(
    detections: Detection[],
    suggestions: Suggestion[],
  ): string {
    const totalSpeedup = Math.min(
      suggestions.reduce((sum, s) => sum + s.estimatedSpeedupPct, 0),
      80,
    );

    const severityCounts = { critical: 0, high: 0, warning: 0, info: 0 };
    for (const d of detections) {
      severityCounts[d.severity]++;
    }

    return `
    <div class="card summary-card">
      <div class="summary-value">+${totalSpeedup.toFixed(1)}%</div>
      <div class="summary-label">Total Potential Improvement</div>
      <div style="margin-top: 1rem; opacity: 0.9;">
        ${severityCounts.critical > 0 ? `🔴 ${severityCounts.critical} critical` : ''}
        ${severityCounts.high > 0 ? `🟠 ${severityCounts.high} high` : ''}
        ${severityCounts.warning > 0 ? `🟡 ${severityCounts.warning} warning` : ''}
        ${severityCounts.info > 0 ? `🔵 ${severityCounts.info} info` : ''}
      </div>
    </div>`;
  }

  /**
   * Generate footer
   */
  private generateFooter(): string {
    return `
    <div class="footer">
      <p>Generated by Render Debugger v${this.version}</p>
      <p>Run <code>render-debugger fix &lt;trace.json&gt;</code> to generate patches</p>
    </div>`;
  }

  /**
   * Get emoji for detection type
   */
  private getDetectionEmoji(type: string): string {
    const emojis: Record<string, string> = {
      layout_thrashing: '📐',
      gpu_stall: '🎮',
      long_task: '⏱️',
      heavy_paint: '🎨',
      forced_reflow: '🔄',
    };
    return emojis[type] ?? '⚠️';
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
   * Find a suggestion that matches a detection
   */
  private findMatchingSuggestion(
    detection: Detection,
    suggestions: Suggestion[],
  ): Suggestion | undefined {
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
      if (detection.type === 'layout_thrashing' && s.type === 'css') {
        return true;
      }
      if (detection.type === 'long_task' && s.type === 'js') {
        return true;
      }
      return false;
    });
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntities[char] ?? char);
  }
}
