/**
 * Analyze Command
 * Performs offline analysis of trace data and generates reports
 *
 * Requirements: 3.1, 3.9, 11.1, 11.2
 */

import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { AnalyzerService } from '../analyzer/analyzer.service.js';
import { SuggesterService } from '../suggester/suggester.service.js';
import { ReporterService } from '../reporter/reporter.service.js';
import { StorageService } from '../services/storage.service.js';
import { ConfigService } from '../services/config.service.js';
import { SourceMapService } from '../services/sourcemap.service.js';
import { ReplayHarnessService } from '../replay-harness/replay-harness.service.js';
import { TraceParseError } from '../errors/error-types.js';
import type { AnalysisReport } from '../reporter/interfaces/index.js';

interface AnalyzeCommandOptions {
  name?: string;
  latest?: boolean;
  fpsTarget?: number;
  json?: string;
  out?: string;
  verbose?: boolean;
  noColor?: boolean;
  sourceMaps?: string[];
  exportHarness?: boolean;
  harnessAll?: boolean;
}

@Injectable()
@Command({
  name: 'analyze',
  aliases: ['a'],
  description: 'Analyze a trace file and generate performance reports',
  arguments: '[trace-file]',
})
export class AnalyzeCommand extends CommandRunner {
  constructor(
    private readonly analyzerService: AnalyzerService,
    private readonly suggesterService: SuggesterService,
    private readonly reporterService: ReporterService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly sourceMapService: SourceMapService,
    private readonly replayHarnessService: ReplayHarnessService,
  ) {
    super();
  }

  async run(
    passedParams: string[],
    options: AnalyzeCommandOptions,
  ): Promise<void> {
    let traceFile = passedParams[0];

    // Auto-detect latest trace if --latest flag or no trace specified
    if (options.latest || !traceFile) {
      console.log('> Searching for latest trace...');
      const latestTrace = await this.storageService.findLatestTrace();
      
      if (!latestTrace) {
        console.error('● Error: No trace files found');
        console.error('   Run `render-debugger profile --url <URL>` first to create a trace');
        console.error('   Or specify a trace file: `render-debugger analyze <trace-file>`');
        process.exit(1);
      }
      
      traceFile = latestTrace;
      console.log(`> Found: ${traceFile}\n`);
    }

    // Auto-generate name if not provided
    const analysisName = options.name || this.generateAutoName(traceFile);

    try {
      console.log('> Starting trace analysis...\n');

      // Load config for defaults
      const config = await this.configService.loadConfig();
      const fpsTarget =
        options.fpsTarget ?? config?.profiling.defaultFpsTarget ?? 60;

      // Load trace data
      console.log(`> Loading trace: ${traceFile}`);
      const traceData = await this.loadTrace(traceFile);

      // Load source maps if provided
      if (options.sourceMaps && options.sourceMaps.length > 0) {
        console.log(
          `> Loading ${options.sourceMaps.length} source map(s)...`,
        );
        await this.sourceMapService.loadSourceMaps(options.sourceMaps);
      }

      // Run analysis
      console.log('> Analyzing trace data...');
      const analysisResult = await this.analyzerService.analyze(traceData, {
        name: analysisName,
        fpsTarget,
        sourceMapPaths: options.sourceMaps,
      });

      // Generate suggestions
      console.log('> Generating suggestions...');
      const suggestions = await this.suggesterService.suggest(
        analysisResult.detections,
      );

      // Build complete report
      const report: AnalysisReport = {
        summary: {
          ...analysisResult.summary,
          suggestions: suggestions.map((s) => ({
            type: s.type,
            target: s.target,
            patch: s.patch,
            estimated_speedup_pct: s.estimatedSpeedupPct,
          })),
        },
        detections: analysisResult.detections,
        suggestions,
      };

      // Generate and display terminal report
      console.log('\n');
      const terminalReport = this.reporterService.generateTerminalReport(
        report,
        {
          colorize: !options.noColor,
          verbose: options.verbose,
        },
      );
      console.log(terminalReport);

      // Write JSON report if requested
      if (options.json) {
        await this.writeJsonReport(report, options.json);
      }

      // Write HTML report if requested
      if (options.out) {
        await this.writeHtmlReport(report, options.out, analysisName);
      }

      // Export replay harness if requested (Requirements 11.1, 11.2)
      if (options.exportHarness) {
        await this.exportReplayHarness(report, { ...options, name: analysisName });
      }

      // Write summary to default location
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const runId = `${analysisName}-${timestamp}`;
      await this.storageService.writeSummary(runId, report.summary);

      console.log('\nArtifacts:');
      console.log(
        `   Summary: ${this.storageService.getTracesDir()}/${runId}/trace-summary.json`,
      );
      if (options.json) {
        console.log(`   JSON Report: ${options.json}`);
      }
      if (options.out) {
        console.log(`   HTML Report: ${options.out}`);
      }

      console.log('\n✓ Analysis complete!\n');
      console.log('Next steps:');
      console.log(
        `  1. Run \`render-debugger fix\` to generate patches`,
      );
      console.log(
        `  2. Run \`render-debugger compare <baseline.json>\` to compare with baseline\n`,
      );

      process.exit(0);
    } catch (error) {
      this.handleError(error, traceFile);
    }
  }

  /**
   * Generate auto name from trace file path
   */
  private generateAutoName(tracePath: string): string {
    const basename = path.basename(tracePath, '.json');
    if (basename === 'trace') {
      // Use parent directory name
      const parentDir = path.basename(path.dirname(tracePath));
      return parentDir !== 'traces' ? parentDir : 'analysis';
    }
    return basename.replace('.trace', '');
  }

  /**
   * Load and parse trace file
   */
  private async loadTrace(tracePath: string) {
    try {
      return await this.storageService.readTrace(tracePath);
    } catch (error) {
      throw new TraceParseError(
        tracePath,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Write JSON report to specified path
   */
  private async writeJsonReport(
    report: AnalysisReport,
    outputPath: string,
  ): Promise<void> {
    const jsonContent = this.reporterService.generateJSONReport(report, {
      prettyPrint: true,
      indent: 2,
    });

    // If path is relative, write to reports directory
    const finalPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(this.storageService.getReportsDir(), outputPath);

    const name = path.basename(finalPath, '.json');
    await this.storageService.writeJsonReport(name, JSON.parse(jsonContent));
    console.log(`> JSON report written to: ${finalPath}`);
  }

  /**
   * Write HTML report to specified path
   */
  private async writeHtmlReport(
    report: AnalysisReport,
    _outputPath: string,
    title: string,
  ): Promise<void> {
    const htmlContent = this.reporterService.generateHTMLReport(report, {
      interactive: true,
      embedAssets: true,
      title: `Render Debugger: ${title}`,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    await this.storageService.writeReport(timestamp, htmlContent);
    console.log(
      `> HTML report written to: ${this.storageService.getReportsDir()}/report-${timestamp}.html`,
    );
  }

  /**
   * Export replay harness for local debugging
   * Requirements: 11.1, 11.2
   */
  private async exportReplayHarness(
    report: AnalysisReport,
    options: AnalyzeCommandOptions,
  ): Promise<void> {
    if (report.detections.length === 0) {
      console.log('  No detections to export as replay harness');
      return;
    }

    console.log('> Generating replay harness...');

    const result = await this.replayHarnessService.generateAndSaveHarness(
      report.detections,
      report.summary,
      {
        name: options.name,
        includeAllDetections: options.harnessAll ?? false,
        includePerformanceMeasurement: true,
        title: `Replay Harness: ${options.name}`,
      },
    );

    console.log(`> Replay harness written to: ${result.filePath}`);
    console.log(`   ${result.summary}`);
    console.log(
      '   Open this file in a browser and use DevTools Performance tab to analyze',
    );
  }

  /**
   * Handle errors with appropriate exit codes
   */
  private handleError(error: unknown, tracePath: string): never {
    if (error instanceof TraceParseError) {
      console.error(`\n● Failed to parse trace file: ${tracePath}`);
      console.error(
        '   Make sure the file exists and contains valid JSON trace data',
      );
      if (error.cause) {
        console.error(`   Cause: ${error.cause.message}`);
      }
      process.exit(error.exitCode);
    }

    // Unknown error
    console.error('\n● An unexpected error occurred during analysis');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.stack) {
        console.error(`\n   Stack trace:\n${error.stack}`);
      }
    }
    process.exit(1);
  }

  @Option({
    flags: '-n, --name <name>',
    description: 'Name for this analysis run (auto-generated if not provided)',
  })
  parseName(val: string): string {
    return val;
  }

  @Option({
    flags: '-l, --latest',
    description: 'Analyze the most recent trace file',
    defaultValue: false,
  })
  parseLatest(): boolean {
    return true;
  }

  @Option({
    flags: '-f, --fps-target <fps>',
    description: 'Target FPS for analysis (default: 60)',
    defaultValue: 60,
  })
  parseFpsTarget(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-j, --json <path>',
    description: 'Output path for JSON report',
  })
  parseJson(val: string): string {
    return val;
  }

  @Option({
    flags: '-o, --out <path>',
    description: 'Output path for HTML report',
  })
  parseOut(val: string): string {
    return val;
  }

  @Option({
    flags: '-v, --verbose',
    description: 'Show verbose output with all issues',
    defaultValue: false,
  })
  parseVerbose(): boolean {
    return true;
  }

  @Option({
    flags: '--no-color',
    description: 'Disable colored output',
    defaultValue: false,
  })
  parseNoColor(): boolean {
    return true;
  }

  @Option({
    flags: '-s, --source-maps <paths...>',
    description: 'Paths to source map files for stack trace resolution',
  })
  parseSourceMaps(val: string, previous: string[] = []): string[] {
    return [...previous, val];
  }

  @Option({
    flags: '-e, --export-harness',
    description:
      'Export a minimal HTML+script replay harness for local debugging',
    defaultValue: false,
  })
  parseExportHarness(): boolean {
    return true;
  }

  @Option({
    flags: '--harness-all',
    description:
      'Include all detections in the replay harness (default: only primary issue)',
    defaultValue: false,
  })
  parseHarnessAll(): boolean {
    return true;
  }
}
