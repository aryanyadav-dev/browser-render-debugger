/**
 * Git Service
 * Handles Git operations for safe patching
 *
 * Requirements: 5.4, 5.6, 5.7, 5.13
 * - Require Git repo for auto-apply
 * - Create branch for changes
 * - Create backup commit before applying
 * - NEVER auto-push changes
 */

import { Injectable, Optional, Inject } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { IGitService } from './interfaces/index.js';
import { GitOperationError } from '../errors/error-types.js';

const execAsync = promisify(exec);

export const GIT_WORKING_DIR = 'GIT_WORKING_DIR';

@Injectable()
export class GitService implements IGitService {
  private readonly workingDir: string;

  constructor(@Optional() @Inject(GIT_WORKING_DIR) workingDir?: string) {
    this.workingDir = workingDir ?? process.cwd();
  }

  /**
   * Execute a git command
   */
  private async execGit(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`git ${command}`, {
        cwd: this.workingDir,
      });
      return stdout.trim();
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      throw new GitOperationError(
        command,
        new Error(err.stderr ?? err.message ?? 'Unknown git error'),
      );
    }
  }

  /**
   * Check if current directory is a Git repository
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit('rev-parse --is-inside-work-tree');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(name: string): Promise<void> {
    await this.execGit(`checkout -b ${this.sanitizeBranchName(name)}`);
  }

  /**
   * Create a backup commit with message
   * Returns the commit hash
   */
  async createBackupCommit(message: string): Promise<string> {
    // Stage all changes first
    await this.execGit('add -A');

    // Create commit
    await this.execGit(
      `commit -m "${this.sanitizeCommitMessage(message)}" --allow-empty`,
    );

    // Get the commit hash
    const hash = await this.execGit('rev-parse HEAD');
    return hash;
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    return await this.execGit('rev-parse --abbrev-ref HEAD');
  }

  /**
   * Check if working tree has uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const status = await this.execGit('status --porcelain');
      return status.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Stage files for commit
   */
  async stageFiles(files: string[]): Promise<void> {
    if (files.length === 0) return;

    const fileList = files.map((f) => `"${f}"`).join(' ');
    await this.execGit(`add ${fileList}`);
  }

  /**
   * Commit staged changes
   * Returns the commit hash
   * NOTE: This method NEVER pushes changes (Requirement 5.13)
   */
  async commit(message: string): Promise<string> {
    await this.execGit(`commit -m "${this.sanitizeCommitMessage(message)}"`);
    const hash = await this.execGit('rev-parse HEAD');
    return hash;
  }

  /**
   * Checkout a branch
   */
  async checkoutBranch(name: string): Promise<void> {
    await this.execGit(`checkout ${this.sanitizeBranchName(name)}`);
  }

  /**
   * Get the root directory of the git repository
   */
  async getRepoRoot(): Promise<string> {
    return await this.execGit('rev-parse --show-toplevel');
  }

  /**
   * Get list of modified files
   */
  async getModifiedFiles(): Promise<string[]> {
    const output = await this.execGit('diff --name-only');
    return output.split('\n').filter((f) => f.length > 0);
  }

  /**
   * Get list of staged files
   */
  async getStagedFiles(): Promise<string[]> {
    const output = await this.execGit('diff --cached --name-only');
    return output.split('\n').filter((f) => f.length > 0);
  }

  /**
   * Reset to a specific commit
   */
  async resetToCommit(
    commitHash: string,
    hard: boolean = false,
  ): Promise<void> {
    const mode = hard ? '--hard' : '--soft';
    await this.execGit(`reset ${mode} ${commitHash}`);
  }

  /**
   * Sanitize branch name to be git-safe
   */
  private sanitizeBranchName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9-_/]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Sanitize commit message
   */
  private sanitizeCommitMessage(message: string): string {
    return message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
