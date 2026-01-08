/**
 * Patcher interfaces for patch generation and application
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14
 */

import type { Suggestion } from '../../shared/types/suggestion.types.js';
import type {
  Patch,
  PatchFailure,
  ApplyOptions,
  ApplyResult,
  DryRunResult,
  BenchmarkMetrics,
} from '../../shared/types/patch.types.js';

/**
 * Interface for Git operations
 */
export interface IGitService {
  /** Check if current directory is a Git repository */
  isGitRepo(): Promise<boolean>;
  /** Create a new branch */
  createBranch(name: string): Promise<void>;
  /** Create a backup commit with message */
  createBackupCommit(message: string): Promise<string>;
  /** Get current branch name */
  getCurrentBranch(): Promise<string>;
  /** Check if working tree has uncommitted changes */
  hasUncommittedChanges(): Promise<boolean>;
  /** Stage files for commit */
  stageFiles(files: string[]): Promise<void>;
  /** Commit staged changes */
  commit(message: string): Promise<string>;
  /** Checkout a branch */
  checkoutBranch(name: string): Promise<void>;
}

/**
 * Interface for patch generation
 */
export interface IPatchGenerator {
  /** Generate patches from suggestions */
  generatePatches(suggestions: Suggestion[]): Promise<Patch[]>;
  /** Generate a single patch from a suggestion */
  generatePatch(suggestion: Suggestion): Promise<Patch | null>;
}

/**
 * Interface for dry-run mode
 */
export interface IDryRunService {
  /** Preview patches without applying */
  preview(patches: Patch[]): Promise<DryRunResult>;
  /** Write patches to disk without applying */
  writePatchFiles(patches: Patch[]): Promise<string[]>;
}

/**
 * Interface for auto-apply mode
 */
export interface IAutoApplyService {
  /** Apply patches with safety checks */
  apply(patches: Patch[], options: ApplyOptions): Promise<ApplyResult>;
  /** Run validation after applying patches */
  runValidation(): Promise<ValidationResult>;
  /** Collect benchmark metrics */
  collectBenchmarks(): Promise<BenchmarkMetrics>;
}

/**
 * Interface for the main patcher service
 */
export interface IPatcherService {
  /** Generate patches from suggestions */
  generatePatches(suggestions: Suggestion[]): Promise<Patch[]>;
  /** Apply patches with options */
  applyPatches(patches: Patch[], options: ApplyOptions): Promise<ApplyResult>;
  /** Dry run - write patches without applying */
  dryRun(patches: Patch[]): Promise<DryRunResult>;
}

/**
 * Validation result after applying patches
 */
export interface ValidationResult {
  success: boolean;
  lintPassed: boolean;
  formatPassed: boolean;
  testsPassed: boolean;
  errors: string[];
}

/**
 * Options for patch generation
 */
export interface PatchGenerationOptions {
  /** Maximum number of patches to generate */
  maxPatches?: number;
  /** Include only high-confidence suggestions */
  highConfidenceOnly?: boolean;
}

/**
 * Fix command options
 */
export interface FixCommandOptions {
  /** Dry run mode - write patches without applying */
  dryRun?: boolean;
  /** Auto-apply mode - apply patches with safety checks */
  autoApply?: boolean;
  /** Create backup of original files */
  backup?: boolean;
  /** Git branch name for auto-apply */
  gitBranch?: string;
  /** Maximum number of patches to generate */
  maxPatches?: number;
  /** Run linter after applying */
  runLint?: boolean;
  /** Run tests after applying */
  runTests?: boolean;
  /** Lint command to run */
  lintCommand?: string;
  /** Test command to run */
  testCommand?: string;
}

export {
  Patch,
  PatchFailure,
  ApplyOptions,
  ApplyResult,
  DryRunResult,
  BenchmarkMetrics,
};
