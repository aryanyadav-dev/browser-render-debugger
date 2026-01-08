/**
 * Reporter Service
 * Orchestrates report generation across terminal, JSON, and HTML formats
 *
 * Requirements: 3.6, 3.7, 3.8, 9.1-9.7
 */

import { Injectable } from '@nestjs/common';
import { TerminalReporter } from './terminal.reporter.js';
import { JSONReporter } from './json.reporter.js';
import { HTMLReporter } from './html.reporter.js';
import type {
  IReporterService,
  AnalysisReport,
  TerminalReportOptions,
  JSONReportOptions,
  HTMLReportOptions,
} from './interfaces/index.js';

@Injectable()
export class ReporterService implements IReporterService {
  constructor(
    private readonly terminalReporter: TerminalReporter,
    private readonly jsonReporter: JSONReporter,
    private readonly htmlReporter: HTMLReporter,
  ) {}

  /**
   * Generate terminal-friendly report string
   */
  generateTerminalReport(
    report: AnalysisReport,
    options?: TerminalReportOptions,
  ): string {
    return this.terminalReporter.generate(report, options);
  }

  /**
   * Generate JSON report string
   */
  generateJSONReport(
    report: AnalysisReport,
    options?: JSONReportOptions,
  ): string {
    return this.jsonReporter.generate(report, options);
  }

  /**
   * Generate HTML report string
   */
  generateHTMLReport(
    report: AnalysisReport,
    options?: HTMLReportOptions,
  ): string {
    return this.htmlReporter.generate(report, options);
  }
}
