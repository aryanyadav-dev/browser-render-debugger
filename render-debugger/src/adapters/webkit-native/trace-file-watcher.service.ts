/**
 * Trace File Watcher Service
 *
 * Monitors a directory for new trace files from the Swift instrumentation SDK.
 * Auto-ingests new trace files as they appear, enabling continuous monitoring
 * workflows with WebKit native browsers.
 *
 * Requirements: 15.11
 */

import { Logger } from '@nestjs/common';
import { watch, FSWatcher } from 'fs';
import { readdir, stat, access, constants } from 'fs/promises';
import { join, extname } from 'path';
import { EventEmitter } from 'events';
import {
  NativeTraceFormat,
  parseNativeTrace,
  validateNativeTrace,
} from './schemas/index.js';

/**
 * Options for the trace file watcher
 */
export interface TraceFileWatcherOptions {
  /** Directory to watch for trace files */
  traceDir: string;
  /** File extension to watch for (default: '.json') */
  fileExtension?: string;
  /** Debounce time in ms for file change events (default: 100) */
  debounceMs?: number;
  /** Whether to process existing files on start (default: false) */
  processExisting?: boolean;
  /** Maximum age of files to process in ms (default: 1 hour) */
  maxFileAgeMs?: number;
  /** Callback for validation errors (optional) */
  onValidationError?: (file: string, errors: string[]) => void;
}

/**
 * Event types emitted by the watcher
 */
export interface TraceFileWatcherEvents {
  /** Emitted when a new valid trace file is detected */
  trace: (trace: NativeTraceFormat, filePath: string) => void;
  /** Emitted when a file fails validation */
  error: (error: Error, filePath: string) => void;
  /** Emitted when the watcher starts */
  start: (traceDir: string) => void;
  /** Emitted when the watcher stops */
  stop: () => void;
  /** Emitted when a file is detected but not yet processed */
  fileDetected: (filePath: string) => void;
}

/**
 * Trace File Watcher
 *
 * Watches a directory for new trace files and emits events when
 * valid traces are detected. Designed for continuous monitoring
 * workflows with the WebKit native adapter.
 */
export class TraceFileWatcher extends EventEmitter {
  private readonly logger = new Logger(TraceFileWatcher.name);
  private watcher: FSWatcher | null = null;
  private readonly options: Required<TraceFileWatcherOptions>;
  private processedFiles = new Set<string>();
  private pendingFiles = new Map<string, NodeJS.Timeout>();
  private isWatching = false;

  constructor(options: TraceFileWatcherOptions) {
    super();

    // Apply defaults
    this.options = {
      traceDir: options.traceDir,
      fileExtension: options.fileExtension ?? '.json',
      debounceMs: options.debounceMs ?? 100,
      processExisting: options.processExisting ?? false,
      maxFileAgeMs: options.maxFileAgeMs ?? 60 * 60 * 1000, // 1 hour
      onValidationError: options.onValidationError ?? (() => {}),
    };
  }

  /**
   * Start watching the trace directory
   */
  async start(): Promise<void> {
    if (this.isWatching) {
      this.logger.warn('Watcher is already running');
      return;
    }

    const { traceDir } = this.options;

    // Validate directory exists
    try {
      await access(traceDir, constants.R_OK);
    } catch {
      throw new Error(`Trace directory not accessible: ${traceDir}`);
    }

    this.logger.log(`Starting trace file watcher on: ${traceDir}`);

    // Process existing files if requested
    if (this.options.processExisting) {
      await this.processExistingFiles();
    }

    // Start watching
    this.watcher = watch(
      traceDir,
      { persistent: true },
      (eventType, filename) => {
        if (filename && eventType === 'rename') {
          this.handleFileEvent(filename);
        }
      },
    );

    this.watcher.on('error', (error) => {
      this.logger.error(`Watcher error: ${error.message}`);
      this.emit('error', error, traceDir);
    });

    this.isWatching = true;
    this.emit('start', traceDir);
  }

  /**
   * Stop watching the trace directory
   */
  stop(): void {
    if (!this.isWatching) {
      return;
    }

    this.logger.log('Stopping trace file watcher');

    // Clear pending file processing
    for (const timeout of this.pendingFiles.values()) {
      clearTimeout(timeout);
    }
    this.pendingFiles.clear();

    // Close the watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;
    this.emit('stop');
  }

  /**
   * Check if the watcher is currently running
   */
  isRunning(): boolean {
    return this.isWatching;
  }

  /**
   * Get the list of processed files
   */
  getProcessedFiles(): string[] {
    return Array.from(this.processedFiles);
  }

  /**
   * Clear the processed files list (allows re-processing)
   */
  clearProcessedFiles(): void {
    this.processedFiles.clear();
  }

  /**
   * Manually trigger processing of a specific file
   */
  async processFile(filePath: string): Promise<NativeTraceFormat | null> {
    return this.processTraceFile(filePath);
  }

  /**
   * Handle a file system event
   */
  private handleFileEvent(filename: string): void {
    const { traceDir, fileExtension, debounceMs } = this.options;

    // Check file extension
    if (extname(filename) !== fileExtension) {
      return;
    }

    const filePath = join(traceDir, filename);

    // Emit file detected event
    this.emit('fileDetected', filePath);

    // Skip if already processed
    if (this.processedFiles.has(filePath)) {
      return;
    }

    // Debounce file processing (files may be written in chunks)
    if (this.pendingFiles.has(filePath)) {
      clearTimeout(this.pendingFiles.get(filePath));
    }

    const timeout = setTimeout(() => {
      this.pendingFiles.delete(filePath);
      this.processTraceFile(filePath).catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Error processing file ${filePath}: ${errorMessage}`);
      });
    }, debounceMs);

    this.pendingFiles.set(filePath, timeout);
  }

  /**
   * Process existing files in the trace directory
   */
  private async processExistingFiles(): Promise<void> {
    const { traceDir, fileExtension, maxFileAgeMs } = this.options;

    this.logger.debug('Processing existing trace files');

    try {
      const files = await readdir(traceDir);
      const now = Date.now();

      for (const filename of files) {
        if (extname(filename) !== fileExtension) {
          continue;
        }

        const filePath = join(traceDir, filename);

        try {
          const stats = await stat(filePath);

          // Skip files older than maxFileAgeMs
          if (now - stats.mtime.getTime() > maxFileAgeMs) {
            this.logger.debug(`Skipping old file: ${filename}`);
            continue;
          }

          await this.processTraceFile(filePath);
        } catch (error) {
          this.logger.warn(
            `Error processing existing file ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error reading trace directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Process a single trace file
   */
  private async processTraceFile(
    filePath: string,
  ): Promise<NativeTraceFormat | null> {
    // Skip if already processed
    if (this.processedFiles.has(filePath)) {
      return null;
    }

    this.logger.debug(`Processing trace file: ${filePath}`);

    try {
      // Check file exists and is readable
      await access(filePath, constants.R_OK);

      // Read file content
      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath, 'utf-8');

      // Parse and validate
      const trace = parseNativeTrace(content);

      // Validate trace
      const validation = validateNativeTrace(trace);

      if (!validation.valid) {
        this.logger.warn(
          `Invalid trace file ${filePath}: ${validation.errors.join(', ')}`,
        );
        this.options.onValidationError(filePath, validation.errors);
        this.emit('error', new Error(validation.errors.join(', ')), filePath);
        return null;
      }

      // Log warnings
      for (const warning of validation.warnings) {
        this.logger.warn(`Trace warning (${filePath}): ${warning}`);
      }

      // Mark as processed
      this.processedFiles.add(filePath);

      // Emit trace event
      this.emit('trace', trace, filePath);

      this.logger.log(
        `Processed trace: ${trace.name} (${trace.frames.length} frames)`,
      );

      return trace;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process trace file ${filePath}: ${errorMessage}`,
      );
      this.emit(
        'error',
        error instanceof Error ? error : new Error(errorMessage),
        filePath,
      );
      return null;
    }
  }
}

/**
 * Factory function to create a TraceFileWatcher
 */
export function createTraceFileWatcher(
  options: TraceFileWatcherOptions,
): TraceFileWatcher {
  return new TraceFileWatcher(options);
}

// Type augmentation for type-safe event emitter
// Using module augmentation pattern to avoid declaration merging issues
declare module 'events' {
  interface EventEmitter {
    on<K extends keyof TraceFileWatcherEvents>(
      event: K,
      listener: TraceFileWatcherEvents[K],
    ): this;
    emit<K extends keyof TraceFileWatcherEvents>(
      event: K,
      ...args: Parameters<TraceFileWatcherEvents[K]>
    ): boolean;
    off<K extends keyof TraceFileWatcherEvents>(
      event: K,
      listener: TraceFileWatcherEvents[K],
    ): this;
    once<K extends keyof TraceFileWatcherEvents>(
      event: K,
      listener: TraceFileWatcherEvents[K],
    ): this;
  }
}
