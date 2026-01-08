/**
 * Replay harness interfaces for exporting minimal reproductions
 */

import type { Detection, TraceSummary } from '../../shared/types/index.js';

/**
 * Options for generating a replay harness
 */
export interface ReplayHarnessOptions {
  /** Name for the harness file */
  name: string;
  /** Include all detections or just the primary one */
  includeAllDetections?: boolean;
  /** Include performance measurement code */
  includePerformanceMeasurement?: boolean;
  /** Custom title for the HTML page */
  title?: string;
}

/**
 * Result of generating a replay harness
 */
export interface ReplayHarnessResult {
  /** The generated HTML content */
  html: string;
  /** Path where the harness was written (if saved) */
  filePath?: string;
  /** Detection types included in the harness */
  includedDetectionTypes: string[];
  /** Summary of what the harness reproduces */
  summary: string;
}

/**
 * Configuration for a specific issue reproduction
 */
export interface IssueReproduction {
  /** Type of issue being reproduced */
  type: 'layout_thrashing' | 'gpu_stall' | 'long_task' | 'heavy_paint';
  /** Description of the issue */
  description: string;
  /** CSS styles needed to reproduce */
  styles: string;
  /** HTML markup needed to reproduce */
  markup: string;
  /** JavaScript code that triggers the issue */
  script: string;
  /** Comments explaining the issue */
  comments: string[];
}

/**
 * Interface for the replay harness service
 */
export interface IReplayHarnessService {
  /**
   * Generate a replay harness from detections
   * @param detections Array of detected performance issues
   * @param summary Trace summary for context
   * @param options Generation options
   * @returns Generated harness result
   */
  generateHarness(
    detections: Detection[],
    summary: TraceSummary,
    options: ReplayHarnessOptions,
  ): ReplayHarnessResult;

  /**
   * Generate and save a replay harness to disk
   * @param detections Array of detected performance issues
   * @param summary Trace summary for context
   * @param options Generation options
   * @returns Generated harness result with file path
   */
  generateAndSaveHarness(
    detections: Detection[],
    summary: TraceSummary,
    options: ReplayHarnessOptions,
  ): Promise<ReplayHarnessResult>;

  /**
   * Generate reproduction code for a specific detection
   * @param detection The detection to reproduce
   * @returns Issue reproduction configuration
   */
  generateReproduction(detection: Detection): IssueReproduction;
}
