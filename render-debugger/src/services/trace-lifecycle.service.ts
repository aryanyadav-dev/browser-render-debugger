import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageService } from './storage.service.js';

/**
 * Configuration for trace lifecycle management
 */
export interface TraceLifecycleConfig {
  /** Maximum trace duration in seconds (5-15s range) */
  maxDurationSeconds: number;
  /** Trace retention period in hours (0 = no auto-cleanup) */
  retentionHours: number;
  /** Maximum memory for trace buffer in MB */
  maxBufferSizeMB: number;
  /** Enable auto-cleanup of old traces */
  autoCleanup: boolean;
}

/**
 * Default trace lifecycle configuration
 */
export const DEFAULT_TRACE_LIFECYCLE_CONFIG: TraceLifecycleConfig = {
  maxDurationSeconds: 15,
  retentionHours: 24,
  maxBufferSizeMB: 100,
  autoCleanup: true,
};

/**
 * Trace file metadata
 */
export interface TraceFileInfo {
  path: string;
  name: string;
  sizeBytes: number;
  createdAt: Date;
  ageHours: number;
}

/**
 * Memory-bounded trace buffer for production safety
 */
export class TraceBuffer {
  private buffer: unknown[] = [];
  private currentSizeBytes = 0;
  private readonly maxSizeBytes: number;

  constructor(maxSizeMB: number) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
  }

  /**
   * Add an event to the buffer, evicting old events if necessary
   */
  add(event: unknown): boolean {
    const eventSize = this.estimateSize(event);

    // If single event exceeds buffer, reject it
    if (eventSize > this.maxSizeBytes) {
      return false;
    }

    // Evict old events until we have space
    while (
      this.currentSizeBytes + eventSize > this.maxSizeBytes &&
      this.buffer.length > 0
    ) {
      const removed = this.buffer.shift();
      if (removed) {
        this.currentSizeBytes -= this.estimateSize(removed);
      }
    }

    this.buffer.push(event);
    this.currentSizeBytes += eventSize;
    return true;
  }

  /**
   * Get all events in the buffer
   */
  getEvents(): unknown[] {
    return [...this.buffer];
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = [];
    this.currentSizeBytes = 0;
  }

  /**
   * Get current buffer size in bytes
   */
  getSizeBytes(): number {
    return this.currentSizeBytes;
  }

  /**
   * Get current buffer size in MB
   */
  getSizeMB(): number {
    return this.currentSizeBytes / (1024 * 1024);
  }

  /**
   * Get number of events in buffer
   */
  getEventCount(): number {
    return this.buffer.length;
  }

  /**
   * Estimate size of an object in bytes
   */
  private estimateSize(obj: unknown): number {
    return JSON.stringify(obj).length * 2; // Rough estimate (UTF-16)
  }
}

/**
 * Service for managing trace lifecycle including duration limits,
 * retention policies, and memory-bounded buffers
 */
@Injectable()
export class TraceLifecycleService {
  private config: TraceLifecycleConfig;
  private traceBuffer: TraceBuffer;
  private traceStartTime: number | null = null;

  constructor(private readonly storageService: StorageService) {
    this.config = { ...DEFAULT_TRACE_LIFECYCLE_CONFIG };
    this.traceBuffer = new TraceBuffer(this.config.maxBufferSizeMB);
  }

  /**
   * Configure trace lifecycle settings
   */
  configure(config: Partial<TraceLifecycleConfig>): void {
    // Validate and clamp maxDurationSeconds to 5-15s range
    if (config.maxDurationSeconds !== undefined) {
      config.maxDurationSeconds = Math.max(
        5,
        Math.min(15, config.maxDurationSeconds),
      );
    }

    this.config = { ...this.config, ...config };

    // Recreate buffer if size changed
    if (config.maxBufferSizeMB !== undefined) {
      this.traceBuffer = new TraceBuffer(this.config.maxBufferSizeMB);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TraceLifecycleConfig {
    return { ...this.config };
  }

  /**
   * Start a new trace session
   */
  startTrace(): void {
    this.traceStartTime = Date.now();
    this.traceBuffer.clear();
  }

  /**
   * Check if trace duration has exceeded the maximum
   */
  isTraceDurationExceeded(): boolean {
    if (this.traceStartTime === null) {
      return false;
    }
    const elapsedSeconds = (Date.now() - this.traceStartTime) / 1000;
    return elapsedSeconds >= this.config.maxDurationSeconds;
  }

  /**
   * Get remaining trace time in seconds
   */
  getRemainingTraceTime(): number {
    if (this.traceStartTime === null) {
      return this.config.maxDurationSeconds;
    }
    const elapsedSeconds = (Date.now() - this.traceStartTime) / 1000;
    return Math.max(0, this.config.maxDurationSeconds - elapsedSeconds);
  }

  /**
   * Get elapsed trace time in seconds
   */
  getElapsedTraceTime(): number {
    if (this.traceStartTime === null) {
      return 0;
    }
    return (Date.now() - this.traceStartTime) / 1000;
  }

  /**
   * End the current trace session
   */
  endTrace(): void {
    this.traceStartTime = null;
  }

  /**
   * Add an event to the memory-bounded buffer
   */
  addTraceEvent(event: unknown): boolean {
    return this.traceBuffer.add(event);
  }

  /**
   * Get all buffered trace events
   */
  getBufferedEvents(): unknown[] {
    return this.traceBuffer.getEvents();
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): { sizeMB: number; eventCount: number; maxSizeMB: number } {
    return {
      sizeMB: this.traceBuffer.getSizeMB(),
      eventCount: this.traceBuffer.getEventCount(),
      maxSizeMB: this.config.maxBufferSizeMB,
    };
  }

  /**
   * Clear the trace buffer
   */
  clearBuffer(): void {
    this.traceBuffer.clear();
  }

  /**
   * List all trace files with metadata
   */
  async listTraceFiles(): Promise<TraceFileInfo[]> {
    const tracesDir = this.storageService.getTracesDir();
    const traceFiles: TraceFileInfo[] = [];

    try {
      const entries = await fs.readdir(tracesDir, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const traceJsonPath = path.join(tracesDir, entry.name, 'trace.json');
          try {
            const stats = await fs.stat(traceJsonPath);
            const ageMs = now - stats.mtime.getTime();
            traceFiles.push({
              path: traceJsonPath,
              name: entry.name,
              sizeBytes: stats.size,
              createdAt: stats.mtime,
              ageHours: ageMs / (1000 * 60 * 60),
            });
          } catch {
            // Skip directories without trace.json
          }
        }
      }
    } catch {
      // Traces directory doesn't exist yet
    }

    return traceFiles;
  }

  /**
   * Get traces that exceed the retention period
   */
  async getExpiredTraces(): Promise<TraceFileInfo[]> {
    if (this.config.retentionHours <= 0) {
      return [];
    }

    const allTraces = await this.listTraceFiles();
    return allTraces.filter(
      (trace) => trace.ageHours > this.config.retentionHours,
    );
  }

  /**
   * Clean up expired traces
   */
  async cleanupExpiredTraces(): Promise<{
    deleted: string[];
    errors: string[];
  }> {
    if (!this.config.autoCleanup) {
      return { deleted: [], errors: [] };
    }

    const expiredTraces = await this.getExpiredTraces();
    const deleted: string[] = [];
    const errors: string[] = [];

    for (const trace of expiredTraces) {
      try {
        const traceDir = path.dirname(trace.path);
        await fs.rm(traceDir, { recursive: true, force: true });
        deleted.push(trace.name);
      } catch (error) {
        errors.push(
          `Failed to delete ${trace.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    return { deleted, errors };
  }

  /**
   * Get total size of all traces in MB
   */
  async getTotalTracesSizeMB(): Promise<number> {
    const traces = await this.listTraceFiles();
    const totalBytes = traces.reduce((sum, trace) => sum + trace.sizeBytes, 0);
    return totalBytes / (1024 * 1024);
  }

  /**
   * Validate that a requested trace duration is within limits
   */
  validateDuration(requestedSeconds: number): {
    valid: boolean;
    clampedValue: number;
    message?: string;
  } {
    const minDuration = 5;
    const maxDuration = this.config.maxDurationSeconds;

    if (requestedSeconds < minDuration) {
      return {
        valid: false,
        clampedValue: minDuration,
        message: `Trace duration must be at least ${minDuration} seconds. Using ${minDuration}s.`,
      };
    }

    if (requestedSeconds > maxDuration) {
      return {
        valid: false,
        clampedValue: maxDuration,
        message: `Trace duration exceeds maximum of ${maxDuration} seconds. Using ${maxDuration}s.`,
      };
    }

    return { valid: true, clampedValue: requestedSeconds };
  }
}
