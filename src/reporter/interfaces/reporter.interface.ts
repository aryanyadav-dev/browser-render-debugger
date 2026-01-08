/**
 * Reporter interfaces for generating terminal, JSON, and HTML reports
 *
 * Requirements: 3.6, 3.7, 3.8, 9.1-9.7
 */

import type { TraceSummary, Detection } from '../../shared/types/index.js';
import type { Suggestion } from '../../shared/types/suggestion.types.js';

/**
 * Analysis result containing all data needed for reporting
 */
export interface AnalysisReport {
  summary: TraceSummary;
  detections: Detection[];
  suggestions: Suggestion[];
}

/**
 * Options for terminal report generation
 */
export interface TerminalReportOptions {
  /** Whether to colorize output */
  colorize?: boolean;
  /** Whether to show verbose details */
  verbose?: boolean;
}

/**
 * Options for JSON report generation
 */
export interface JSONReportOptions {
  /** Whether to pretty-print the JSON */
  prettyPrint?: boolean;
  /** Indentation level for pretty printing */
  indent?: number;
}

/**
 * Options for HTML report generation
 */
export interface HTMLReportOptions {
  /** Whether to include interactive features */
  interactive?: boolean;
  /** Whether to embed all assets (CSS/JS) in single file */
  embedAssets?: boolean;
  /** Custom title for the report */
  title?: string;
}

/**
 * Interface for the main reporter service
 */
export interface IReporterService {
  /** Generate terminal-friendly report string */
  generateTerminalReport(
    report: AnalysisReport,
    options?: TerminalReportOptions,
  ): string;

  /** Generate JSON report string */
  generateJSONReport(
    report: AnalysisReport,
    options?: JSONReportOptions,
  ): string;

  /** Generate HTML report string */
  generateHTMLReport(
    report: AnalysisReport,
    options?: HTMLReportOptions,
  ): string;
}
