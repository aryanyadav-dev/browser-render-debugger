/**
 * Fix Command
 * Generates and optionally applies patches for identified performance issues
 *
 * Requirements: 5.12, 5.14, 9.7, 15.22
 * - Generate patches for top N issues
 * - Display patch summary with before/after metrics
 * - Support dry-run and auto-apply modes
 * - Filter native code suggestions (suggestion-only, no auto-patching)
 */

import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { AnalyzerService } from '../analyzer/analyzer.service.js';
import { SuggesterService } from '../suggester/suggester.service.js';
import { StorageService } from '../services/storage.service.js';
import { ConfigService } from '../services/config.service.js';
import { PatchGeneratorService } from '../patcher/patch-generator.service.js';
import { DryRunService } from '../patcher/dry-run.service.js';
import { AutoApplyService } from '../patcher/auto-apply.service.js';
import { FixTargetFilterService } from '../patcher/fix-target-filter.service.js';
import {
  TraceParseError,
  GitRequiredError,
  DirtyWorkingTreeError,
} from '../errors/error-types.js';
import type { FixCommandOptions } from '../patcher/interfaces/index.js';
import type {
  Suggestion,
  NativeSuggestion,
} from '../shared/types/suggestion.types.js';

@Injectable()
@Command({
  name: 'fix',
  aliases: ['f'],
  description: 'Generate and optionally apply patches for performance issues',
  arguments: '<trace-file>',
})
export class FixCommand extends CommandRunner {
  constructor(
    private readonly analyzerService: AnalyzerService,
    private readonly suggesterService: SuggesterService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly patchGenerator: PatchGeneratorService,
    private readonly dryRunService: DryRunService,
    private readonly autoApplyService: AutoApplyService,
    private readonly fixTargetFilter: FixTargetFilterService,
  ) {
    super();
  }

  async run(passedParams: string[], options: FixCommandOptions): Promise<void> {
    const traceFile = passedParams[0];

    if (!traceFile) {
      console.error('● Error: Trace file path is required');
      console.error('Usage: render-debugger fix <trace-file> [options]');
      process.exit(1);
    }

    try {
      console.log('> Starting fix generation...\n');

      // Load config for defaults
      const config = await this.configService.loadConfig();
      const fpsTarget = config?.profiling.defaultFpsTarget ?? 60;

      // Load trace data
      console.log(`> Loading trace: ${traceFile}`);
      const traceData = await this.loadTrace(traceFile);

      // Run analysis
      console.log('> Analyzing trace data...');
      const analysisResult = await this.analyzerService.analyze(traceData, {
        name: 'fix-analysis',
        fpsTarget,
      });

      // Generate suggestions
      console.log('> Generating suggestions...');
      const suggestions = await this.suggesterService.suggest(
        analysisResult.detections,
      );

      if (suggestions.length === 0) {
        console.log('\n✓ No performance issues found that can be auto-fixed.');
        console.log('   The trace looks good!');
        process.exit(0);
      }

      // Filter suggestions by fix target type
      const filteredSuggestions =
        this.fixTargetFilter.filterSuggestions(suggestions);

      console.log(`\n> Found ${suggestions.length} suggestion(s)`);
      console.log(
        `   ├─ ${filteredSuggestions.patchable.length} auto-patchable (JS/CSS)`,
      );
      console.log(
        `   └─ ${filteredSuggestions.suggestionOnly.length} suggestion-only (native/other)`,
      );

      // Generate patches only for patchable suggestions
      console.log('\n> Generating patches for JS/CSS resources...');
      const patches = await this.patchGenerator.generatePatches(
        filteredSuggestions.patchable,
        {
          maxPatches: options.maxPatches ?? 10,
          highConfidenceOnly: false,
        },
      );

      if (
        patches.length === 0 &&
        filteredSuggestions.suggestionOnly.length === 0
      ) {
        console.log('\n⚠ Could not generate patches for the suggestions.');
        console.log(
          '   The affected files may not be accessible or the code patterns may have changed.',
        );
        process.exit(0);
      }

      if (patches.length > 0) {
        console.log(`   Generated ${patches.length} patch(es)`);
      }

      // Display patchable suggestions summary
      if (filteredSuggestions.patchable.length > 0) {
        this.displaySuggestionsSummary(
          filteredSuggestions.patchable,
          'Auto-Patchable Suggestions (JS/CSS)',
        );
      }

      // Display native/suggestion-only items
      if (filteredSuggestions.suggestionOnly.length > 0) {
        this.displayNativeSuggestions(filteredSuggestions.suggestionOnly);
      }

      // Handle dry-run mode (default)
      if (options.dryRun || !options.autoApply) {
        console.log('\n> Dry Run Mode');
        console.log('───────────────');

        if (patches.length > 0) {
          const dryRunResult = await this.dryRunService.preview(patches);

          console.log(
            this.dryRunService.generatePreviewText(dryRunResult.patches),
          );

          console.log(
            `\n> Patches written to: ${this.storageService.getPatchesDir()}`,
          );
          for (const patchPath of dryRunResult.patchPaths) {
            console.log(`   ${patchPath}`);
          }

          console.log('\n> To apply these patches, run:');
          console.log(`   render-debugger fix ${traceFile} --auto-apply`);
        } else {
          console.log('   No patches to apply (only native suggestions found)');
        }

        if (filteredSuggestions.suggestionOnly.length > 0) {
          console.log(
            '\n⚠ Note: Native code suggestions above require manual implementation.',
          );
          console.log(
            '   Auto-patching is only available for JS/CSS resources.',
          );
        }

        process.exit(0);
      }

      // Handle auto-apply mode
      if (options.autoApply) {
        console.log('\n> Auto-Apply Mode');
        console.log('──────────────────');

        if (patches.length === 0) {
          console.log('   No patches to apply (only native suggestions found)');
          console.log(
            '\n⚠ Native code suggestions require manual implementation.',
          );
          process.exit(0);
        }

        // Configure validation commands
        if (options.lintCommand) {
          this.autoApplyService.setLintCommand(options.lintCommand);
        }
        if (options.testCommand) {
          this.autoApplyService.setTestCommand(options.testCommand);
        }

        try {
          const applyResult = await this.autoApplyService.apply(patches, {
            autoApply: true,
            dryRun: false,
            backup: options.backup ?? true,
            gitBranch: options.gitBranch,
          });

          // Display summary
          console.log(this.autoApplyService.generateSummary(applyResult));

          if (filteredSuggestions.suggestionOnly.length > 0) {
            console.log(
              '\n⚠ Note: Native code suggestions above require manual implementation.',
            );
          }

          if (applyResult.success) {
            process.exit(0);
          } else {
            process.exit(1);
          }
        } catch (error) {
          this.handleAutoApplyError(error);
        }
      }
    } catch (error) {
      this.handleError(error, traceFile);
    }
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
   * Display a summary of suggestions
   */
  private displaySuggestionsSummary(
    suggestions: Suggestion[],
    title = 'Suggestions Summary',
  ): void {
    console.log(`\n> ${title}`);
    console.log('─'.repeat(title.length + 4));

    let totalSpeedup = 0;

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      if (!s) continue;

      console.log(`\n${i + 1}. ${s.description}`);
      console.log(`   Type: ${s.type.toUpperCase()}`);
      console.log(`   Target: ${s.target}`);
      console.log(`   Confidence: ${s.confidence}`);
      console.log(`   Est. Speedup: ${s.estimatedSpeedupPct}%`);

      if (s.warnings.length > 0) {
        console.log(`   ⚠ Warnings:`);
        for (const warning of s.warnings) {
          console.log(`      - ${warning}`);
        }
      }

      totalSpeedup += s.estimatedSpeedupPct;
    }

    console.log('\n' + '─'.repeat(title.length + 4));
    console.log(`Total potential improvement: ~${Math.min(totalSpeedup, 80)}%`);
    console.log('(Capped at 80% - actual results may vary)');
  }

  /**
   * Display native/suggestion-only items
   */
  private displayNativeSuggestions(
    suggestions: (Suggestion | NativeSuggestion)[],
  ): void {
    console.log(
      '\n> Native Code Suggestions (Manual Implementation Required)',
    );
    console.log('─'.repeat(55));
    console.log(
      '⚠ The following suggestions are for native code and cannot be auto-patched.',
    );
    console.log('   Please implement these changes manually.\n');

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      if (!s) continue;

      console.log(`${i + 1}. ${s.description}`);
      console.log(`   Target: ${s.target}`);
      console.log(`   Confidence: ${s.confidence}`);
      console.log(`   Est. Speedup: ${s.estimatedSpeedupPct}%`);

      // Show documentation links if available
      if (s.documentationLinks && s.documentationLinks.length > 0) {
        console.log(`   Documentation:`);
        for (const link of s.documentationLinks) {
          console.log(`      - ${link}`);
        }
      }

      // Show fix guidance for native suggestions
      if ('fixGuidance' in s && s.fixGuidance) {
        console.log(`   Fix Guidance: ${s.fixGuidance}`);
      }

      // Show code example if available
      if ('codeExample' in s && s.codeExample) {
        console.log(`   Example:`);
        const lines = s.codeExample.split('\n');
        for (const line of lines) {
          console.log(`      ${line}`);
        }
      }

      console.log('');
    }
  }

  /**
   * Handle auto-apply specific errors
   */
  private handleAutoApplyError(error: unknown): never {
    if (error instanceof GitRequiredError) {
      console.error('\n● Auto-apply requires a Git repository');
      console.error('   Initialize git with `git init` or use --dry-run mode');
      process.exit(error.exitCode);
    }

    if (error instanceof DirtyWorkingTreeError) {
      console.error('\n● Working tree has uncommitted changes');
      console.error(
        '   Commit or stash your changes before using --auto-apply',
      );
      process.exit(error.exitCode);
    }

    // Re-throw for general error handling
    throw error;
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

    if (error instanceof GitRequiredError) {
      console.error('\n● Auto-apply requires a Git repository');
      console.error('   Initialize git with `git init` or use --dry-run mode');
      process.exit(error.exitCode);
    }

    if (error instanceof DirtyWorkingTreeError) {
      console.error('\n● Working tree has uncommitted changes');
      console.error(
        '   Commit or stash your changes before using --auto-apply',
      );
      process.exit(error.exitCode);
    }

    // Unknown error
    console.error('\n● An unexpected error occurred');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.stack) {
        console.error(`\n   Stack trace:\n${error.stack}`);
      }
    }
    process.exit(1);
  }

  @Option({
    flags: '-d, --dry-run',
    description: 'Write patches without applying (default behavior)',
    defaultValue: false,
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-a, --auto-apply',
    description: 'Apply patches automatically (requires Git repo)',
    defaultValue: false,
  })
  parseAutoApply(): boolean {
    return true;
  }

  @Option({
    flags: '-b, --backup',
    description: 'Create backup of original files before applying',
    defaultValue: true,
  })
  parseBackup(): boolean {
    return true;
  }

  @Option({
    flags: '-g, --git-branch <branch>',
    description:
      'Git branch name for auto-apply (default: render-debugger/auto-fix-<timestamp>)',
  })
  parseGitBranch(val: string): string {
    return val;
  }

  @Option({
    flags: '-m, --max-patches <count>',
    description: 'Maximum number of patches to generate (default: 10)',
    defaultValue: 10,
  })
  parseMaxPatches(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '--lint-command <command>',
    description: 'Lint command to run after applying (default: npm run lint)',
  })
  parseLintCommand(val: string): string {
    return val;
  }

  @Option({
    flags: '--test-command <command>',
    description: 'Test command to run after applying (default: npm test)',
  })
  parseTestCommand(val: string): string {
    return val;
  }

  @Option({
    flags: '--no-lint',
    description: 'Skip linting after applying patches',
    defaultValue: false,
  })
  parseNoLint(): boolean {
    return true;
  }

  @Option({
    flags: '--no-tests',
    description: 'Skip tests after applying patches',
    defaultValue: false,
  })
  parseNoTests(): boolean {
    return true;
  }
}
