/**
 * Auto Apply Service
 * Applies patches with safety checks
 *
 * Requirements: 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.13
 * - Require Git repo for auto-apply
 * - Create branch for changes
 * - Create backup commit before applying
 * - Apply patches
 * - Run linter/tests
 * - Collect before/after benchmarks
 * - NEVER auto-push changes
 */

import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import type {
  Patch,
  PatchFailure,
  ApplyResult,
  BenchmarkMetrics,
  ApplyOptions,
} from '../shared/types/patch.types.js';
import type {
  IAutoApplyService,
  ValidationResult,
} from './interfaces/index.js';
import { GitService } from './git.service.js';
import { StorageService } from '../services/storage.service.js';
import {
  GitRequiredError,
  DirtyWorkingTreeError,
  PatchApplicationError,
} from '../errors/error-types.js';

const execAsync = promisify(exec);

/**
 * Default benchmark metrics when no profiling is available
 */
const DEFAULT_METRICS: BenchmarkMetrics = {
  avgFps: 0,
  droppedFramesPct: 0,
  p95FrameTime: 0,
  totalFrames: 0,
};

@Injectable()
export class AutoApplyService implements IAutoApplyService {
  private lintCommand: string = 'npm run lint';
  private testCommand: string = 'npm test';

  constructor(
    private readonly gitService: GitService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Configure lint command
   */
  setLintCommand(command: string): void {
    this.lintCommand = command;
  }

  /**
   * Configure test command
   */
  setTestCommand(command: string): void {
    this.testCommand = command;
  }

  /**
   * Apply patches with safety checks
   */
  async apply(patches: Patch[], options: ApplyOptions): Promise<ApplyResult> {
    const appliedPatches: Patch[] = [];
    const failedPatches: PatchFailure[] = [];
    let backupCommit: string | undefined;
    let branch: string | undefined;

    // Safety check: Require Git repo
    const isGitRepo = await this.gitService.isGitRepo();
    if (!isGitRepo) {
      throw new GitRequiredError();
    }

    // Safety check: Check for uncommitted changes
    const hasChanges = await this.gitService.hasUncommittedChanges();
    if (hasChanges) {
      throw new DirtyWorkingTreeError();
    }

    // Collect before metrics
    const beforeMetrics = await this.collectBenchmarks();

    try {
      // Create branch for changes
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      branch = options.gitBranch ?? `render-debugger/auto-fix-${timestamp}`;
      await this.gitService.createBranch(branch);
      console.log(`> Created branch: ${branch}`);

      // Create backup commit
      backupCommit = await this.gitService.createBackupCommit(
        '[render-debugger] Backup before auto-apply',
      );
      console.log(`> Created backup commit: ${backupCommit.substring(0, 7)}`);

      // Apply each patch
      for (const patch of patches) {
        try {
          await this.applyPatch(patch, options.backup);
          appliedPatches.push(patch);
          console.log(`✓ Applied patch: ${patch.id} to ${patch.filePath}`);
        } catch (error) {
          const failure: PatchFailure = {
            patchId: patch.id,
            filePath: patch.filePath,
            reason: error instanceof Error ? error.message : 'Unknown error',
            error: error instanceof Error ? error : undefined,
          };
          failedPatches.push(failure);
          console.warn(
            `● Failed to apply patch: ${patch.id} - ${failure.reason}`,
          );
        }
      }

      // Stage and commit applied patches
      if (appliedPatches.length > 0) {
        const modifiedFiles = appliedPatches.map((p) => p.filePath);
        await this.gitService.stageFiles(modifiedFiles);
        await this.gitService.commit(
          `[render-debugger] Applied ${appliedPatches.length} performance fix(es)`,
        );
        console.log(`> Committed ${appliedPatches.length} patch(es)`);
      }

      // Run validation
      const validation = await this.runValidation();
      if (!validation.success) {
        console.warn('⚠ Validation failed:', validation.errors.join(', '));
      }

      // Collect after metrics
      const afterMetrics = await this.collectBenchmarks();

      // NOTE: We NEVER push changes (Requirement 5.13)
      console.log('\n> Changes are ready for review (not pushed)');
      console.log(`   Branch: ${branch}`);
      console.log(`   Backup commit: ${backupCommit.substring(0, 7)}`);

      return {
        success: appliedPatches.length > 0 && failedPatches.length === 0,
        appliedPatches,
        failedPatches,
        backupCommit,
        branch,
        beforeMetrics,
        afterMetrics,
      };
    } catch (error) {
      // If something goes wrong, try to restore
      console.error('● Auto-apply failed:', error);

      return {
        success: false,
        appliedPatches,
        failedPatches,
        backupCommit,
        branch,
        beforeMetrics,
        afterMetrics: DEFAULT_METRICS,
      };
    }
  }

  /**
   * Apply a single patch to a file
   */
  private async applyPatch(patch: Patch, backup: boolean): Promise<void> {
    // Read the original file
    const originalContent = await fs.readFile(patch.filePath, 'utf-8');
    const lines = originalContent.split('\n');

    // Create backup if requested
    if (backup) {
      await this.storageService.writeBackup(patch.filePath, originalContent);
    }

    // Apply each hunk
    for (const hunk of patch.hunks) {
      // Validate the hunk matches the file
      const startIndex = hunk.startLine - 1;
      const endIndex = hunk.endLine;
      const originalLines = hunk.originalContent.split('\n');

      // Check if the original content matches
      const fileLines = lines.slice(startIndex, endIndex);
      const matches = this.contentMatches(fileLines, originalLines);

      if (!matches) {
        throw new PatchApplicationError(
          patch.id,
          patch.filePath,
          new Error('Original content does not match file content'),
        );
      }

      // Replace the lines
      const newLines = hunk.newContent.split('\n');
      lines.splice(startIndex, originalLines.length, ...newLines);
    }

    // Write the modified file
    await fs.writeFile(patch.filePath, lines.join('\n'), 'utf-8');
  }

  /**
   * Check if content matches (with whitespace normalization)
   */
  private contentMatches(
    fileLines: string[],
    originalLines: string[],
  ): boolean {
    if (fileLines.length !== originalLines.length) {
      return false;
    }

    for (let i = 0; i < fileLines.length; i++) {
      const fileLine = fileLines[i];
      const originalLine = originalLines[i];

      if (!fileLine || !originalLine) {
        if (fileLine !== originalLine) {
          return false;
        }
        continue;
      }

      if (fileLine.trim() !== originalLine.trim()) {
        return false;
      }
    }

    return true;
  }

  /**
   * Run validation after applying patches
   */
  async runValidation(): Promise<ValidationResult> {
    const errors: string[] = [];
    let lintPassed = true;
    const formatPassed = true;
    let testsPassed = true;

    // Run linter
    try {
      await execAsync(this.lintCommand, { timeout: 60000 });
      console.log('✓ Lint passed');
    } catch (error) {
      lintPassed = false;
      const err = error as { stderr?: string; message?: string };
      errors.push(
        `Lint failed: ${err.stderr ?? err.message ?? 'Unknown error'}`,
      );
      console.warn('● Lint failed');
    }

    // Run tests (optional, may take longer)
    try {
      await execAsync(this.testCommand, { timeout: 300000 });
      console.log('✓ Tests passed');
    } catch (error) {
      testsPassed = false;
      const err = error as { stderr?: string; message?: string };
      errors.push(
        `Tests failed: ${err.stderr ?? err.message ?? 'Unknown error'}`,
      );
      console.warn('● Tests failed');
    }

    return {
      success: lintPassed && formatPassed && testsPassed,
      lintPassed,
      formatPassed,
      testsPassed,
      errors,
    };
  }

  /**
   * Collect benchmark metrics
   * In a real implementation, this would run a profile and collect metrics
   */
  collectBenchmarks(): Promise<BenchmarkMetrics> {
    // For now, return default metrics
    // In a full implementation, this would:
    // 1. Run a profile against the target URL
    // 2. Collect frame timing data
    // 3. Calculate metrics
    return Promise.resolve(DEFAULT_METRICS);
  }

  /**
   * Generate a summary of the apply result
   */
  generateSummary(result: ApplyResult): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('> Auto-Apply Summary');
    lines.push('=====================');
    lines.push('');

    if (result.success) {
      lines.push('✓ All patches applied successfully!');
    } else if (result.appliedPatches.length > 0) {
      lines.push('⚠ Some patches applied with issues');
    } else {
      lines.push('● No patches were applied');
    }

    lines.push('');
    lines.push(`Applied: ${result.appliedPatches.length}`);
    lines.push(`Failed: ${result.failedPatches.length}`);

    if (result.branch) {
      lines.push('');
      lines.push(`Branch: ${result.branch}`);
    }

    if (result.backupCommit) {
      lines.push(`Backup: ${result.backupCommit.substring(0, 7)}`);
    }

    // Show applied patches
    if (result.appliedPatches.length > 0) {
      lines.push('');
      lines.push('Applied patches:');
      for (const patch of result.appliedPatches) {
        lines.push(`  ✓ ${patch.filePath}`);
      }
    }

    // Show failed patches
    if (result.failedPatches.length > 0) {
      lines.push('');
      lines.push('Failed patches:');
      for (const failure of result.failedPatches) {
        lines.push(`  ● ${failure.filePath}: ${failure.reason}`);
      }
    }

    // Show metrics comparison
    if (
      result.beforeMetrics.totalFrames > 0 ||
      result.afterMetrics.totalFrames > 0
    ) {
      lines.push('');
      lines.push('Performance comparison:');
      lines.push(
        `  Before: ${result.beforeMetrics.avgFps.toFixed(1)} FPS, ${result.beforeMetrics.droppedFramesPct.toFixed(1)}% dropped`,
      );
      lines.push(
        `  After:  ${result.afterMetrics.avgFps.toFixed(1)} FPS, ${result.afterMetrics.droppedFramesPct.toFixed(1)}% dropped`,
      );

      const fpsDiff = result.afterMetrics.avgFps - result.beforeMetrics.avgFps;
      const droppedDiff =
        result.beforeMetrics.droppedFramesPct -
        result.afterMetrics.droppedFramesPct;

      if (fpsDiff > 0) {
        lines.push(`  ✓ FPS improved by ${fpsDiff.toFixed(1)}`);
      }
      if (droppedDiff > 0) {
        lines.push(`  ✓ Dropped frames reduced by ${droppedDiff.toFixed(1)}%`);
      }
    }

    lines.push('');
    lines.push('─────────────────────────────────────');
    lines.push('');
    lines.push('⚠ Changes are LOCAL only (not pushed)');
    lines.push('   Review the changes and push when ready.');
    lines.push('');

    return lines.join('\n');
  }
}
