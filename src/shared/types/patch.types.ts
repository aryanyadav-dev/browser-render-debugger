/**
 * Patch types for code modification
 */

export interface PatchHunk {
  startLine: number;
  endLine: number;
  originalContent: string;
  newContent: string;
}

export interface Patch {
  id: string;
  suggestionId: string;
  filePath: string;
  hunks: PatchHunk[];
  type: 'css' | 'js';
}

export interface PatchFailure {
  patchId: string;
  filePath: string;
  reason: string;
  error?: Error;
}

export interface BenchmarkMetrics {
  avgFps: number;
  droppedFramesPct: number;
  p95FrameTime: number;
  totalFrames: number;
}

export interface ApplyOptions {
  autoApply: boolean;
  dryRun: boolean;
  backup: boolean;
  gitBranch?: string;
}

export interface ApplyResult {
  success: boolean;
  appliedPatches: Patch[];
  failedPatches: PatchFailure[];
  backupCommit?: string;
  branch?: string;
  beforeMetrics: BenchmarkMetrics;
  afterMetrics: BenchmarkMetrics;
}

export interface DryRunResult {
  patches: Patch[];
  patchPaths: string[];
  wouldModify: string[];
}
