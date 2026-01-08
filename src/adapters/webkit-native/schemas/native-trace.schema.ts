/**
 * Native Trace JSON Schema
 *
 * Defines the NativeTraceFormat interface matching the Swift SDK output.
 * This schema is used by the WebKit Native Adapter to ingest sanitized
 * JSON traces from the Swift instrumentation SDK.
 *
 * Requirements: 15.10
 */

/**
 * Frame timing data from CADisplayLink
 */
export interface NativeFrameTiming {
  /** Frame sequence number */
  frameId: number;
  /** Frame start timestamp in microseconds (since trace start) */
  startTimestamp: number;
  /** Frame end timestamp in microseconds */
  endTimestamp: number;
  /** Frame duration in milliseconds */
  durationMs: number;
  /** Whether this frame was dropped (exceeded budget) */
  dropped: boolean;
  /** Target timestamp from CADisplayLink */
  targetTimestamp?: number;
  /** Actual presentation timestamp */
  actualPresentationTimestamp?: number;
}

/**
 * Long task information from os_signpost or PerformanceObserver
 */
export interface NativeLongTask {
  /** Task start timestamp in microseconds */
  startTimestamp: number;
  /** Task duration in milliseconds */
  durationMs: number;
  /** Task name/label from os_signpost */
  name?: string;
  /** Category from os_signpost */
  category?: string;
  /** Source: 'native' for os_signpost, 'webview' for PerformanceObserver */
  source: 'native' | 'webview';
  /** Function name if available (from JS bridge) */
  functionName?: string;
  /** File path if available */
  file?: string;
  /** Line number if available */
  line?: number;
  /** Column number if available */
  column?: number;
}

/**
 * Basic DOM signal from WebView instrumentation
 * Limited compared to CDP - only basic layout/style events
 */
export interface NativeDOMSignal {
  /** Signal type */
  type: 'layout' | 'style_recalc' | 'dom_mutation';
  /** Timestamp in microseconds */
  timestamp: number;
  /** Duration in milliseconds if applicable */
  durationMs?: number;
  /** Number of affected nodes (if available) */
  affectedNodes?: number;
  /** CSS selector hint (if available) */
  selector?: string;
}

/**
 * Metadata about the trace collection environment
 */
export interface NativeTraceMetadata {
  /** App bundle identifier */
  bundleId?: string;
  /** App version */
  appVersion?: string;
  /** iOS/macOS version */
  osVersion?: string;
  /** Device model */
  deviceModel?: string;
  /** Screen dimensions */
  screenSize?: {
    width: number;
    height: number;
  };
  /** Device pixel ratio / scale factor */
  scale?: number;
  /** Trace collection timestamp (ISO 8601) */
  timestamp: string;
  /** Target FPS (typically 60 or 120) */
  fpsTarget: number;
  /** URL being profiled (if WebView) */
  url?: string;
  /** Scenario name if applicable */
  scenario?: string;
  /** SDK version that generated this trace */
  sdkVersion?: string;
  /** Whether this is a sampled trace */
  sampled?: boolean;
  /** Sampling rate if sampled (0.0 - 1.0) */
  samplingRate?: number;
}

/**
 * NativeTraceFormat - The JSON schema for Swift SDK trace output
 *
 * This format is designed to be:
 * - Sanitized: No DOM content, no user PII
 * - Lightweight: Only essential performance data
 * - Compatible: Can be normalized to TraceSnapshot
 */
export interface NativeTraceFormat {
  /** Schema version for forward compatibility */
  version: string;
  /** Unique trace identifier */
  traceId: string;
  /** Human-readable name for this trace */
  name: string;
  /** Total trace duration in milliseconds */
  durationMs: number;
  /** Frame timing data from CADisplayLink */
  frames: NativeFrameTiming[];
  /** Long tasks detected (> 50ms) */
  longTasks: NativeLongTask[];
  /** DOM signals from WebView (limited) */
  domSignals: NativeDOMSignal[];
  /** Trace metadata */
  metadata: NativeTraceMetadata;
}

/**
 * Validation result for native trace format
 */
export interface NativeTraceValidationResult {
  /** Whether the trace is valid */
  valid: boolean;
  /** Validation errors if invalid */
  errors: string[];
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Required fields for a valid native trace
 */
const REQUIRED_FIELDS = [
  'version',
  'traceId',
  'name',
  'durationMs',
  'frames',
  'metadata',
] as const;

/**
 * Required metadata fields
 */
const REQUIRED_METADATA_FIELDS = ['timestamp', 'fpsTarget'] as const;

/**
 * Supported schema versions
 */
const SUPPORTED_VERSIONS = ['1.0', '1.1'] as const;

/**
 * Validate a native trace format object
 *
 * @param trace The trace object to validate
 * @returns Validation result with errors and warnings
 */
export function validateNativeTrace(
  trace: unknown,
): NativeTraceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if trace is an object
  if (!trace || typeof trace !== 'object') {
    return {
      valid: false,
      errors: ['Trace must be a non-null object'],
      warnings: [],
    };
  }

  const traceObj = trace as Record<string, unknown>;

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in traceObj)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate version
  if (traceObj.version !== undefined) {
    if (typeof traceObj.version !== 'string') {
      errors.push('Field "version" must be a string');
    } else if (
      !SUPPORTED_VERSIONS.includes(
        traceObj.version as (typeof SUPPORTED_VERSIONS)[number],
      )
    ) {
      warnings.push(
        `Unknown schema version: ${traceObj.version}. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
      );
    }
  }

  // Validate traceId
  if (traceObj.traceId !== undefined && typeof traceObj.traceId !== 'string') {
    errors.push('Field "traceId" must be a string');
  }

  // Validate name
  if (traceObj.name !== undefined && typeof traceObj.name !== 'string') {
    errors.push('Field "name" must be a string');
  }

  // Validate durationMs
  if (traceObj.durationMs !== undefined) {
    if (typeof traceObj.durationMs !== 'number' || traceObj.durationMs < 0) {
      errors.push('Field "durationMs" must be a non-negative number');
    }
  }

  // Validate frames array
  if (traceObj.frames !== undefined) {
    if (!Array.isArray(traceObj.frames)) {
      errors.push('Field "frames" must be an array');
    } else {
      const frameErrors = validateFrames(traceObj.frames);
      errors.push(...frameErrors);
    }
  }

  // Validate longTasks array (optional)
  if (traceObj.longTasks !== undefined) {
    if (!Array.isArray(traceObj.longTasks)) {
      errors.push('Field "longTasks" must be an array');
    } else {
      const taskErrors = validateLongTasks(traceObj.longTasks);
      errors.push(...taskErrors);
    }
  }

  // Validate domSignals array (optional)
  if (traceObj.domSignals !== undefined) {
    if (!Array.isArray(traceObj.domSignals)) {
      errors.push('Field "domSignals" must be an array');
    }
  }

  // Validate metadata
  if (traceObj.metadata !== undefined) {
    if (typeof traceObj.metadata !== 'object' || traceObj.metadata === null) {
      errors.push('Field "metadata" must be an object');
    } else {
      const metadataErrors = validateMetadata(
        traceObj.metadata as Record<string, unknown>,
      );
      errors.push(...metadataErrors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate frames array
 */
function validateFrames(frames: unknown[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame || typeof frame !== 'object') {
      errors.push(`Frame at index ${i} must be an object`);
      continue;
    }

    const frameObj = frame as Record<string, unknown>;

    if (typeof frameObj.frameId !== 'number') {
      errors.push(`Frame at index ${i}: "frameId" must be a number`);
    }
    if (typeof frameObj.startTimestamp !== 'number') {
      errors.push(`Frame at index ${i}: "startTimestamp" must be a number`);
    }
    if (typeof frameObj.endTimestamp !== 'number') {
      errors.push(`Frame at index ${i}: "endTimestamp" must be a number`);
    }
    if (typeof frameObj.durationMs !== 'number') {
      errors.push(`Frame at index ${i}: "durationMs" must be a number`);
    }
    if (typeof frameObj.dropped !== 'boolean') {
      errors.push(`Frame at index ${i}: "dropped" must be a boolean`);
    }
  }

  return errors;
}

/**
 * Validate long tasks array
 */
function validateLongTasks(tasks: unknown[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task || typeof task !== 'object') {
      errors.push(`Long task at index ${i} must be an object`);
      continue;
    }

    const taskObj = task as Record<string, unknown>;

    if (typeof taskObj.startTimestamp !== 'number') {
      errors.push(`Long task at index ${i}: "startTimestamp" must be a number`);
    }
    if (typeof taskObj.durationMs !== 'number') {
      errors.push(`Long task at index ${i}: "durationMs" must be a number`);
    }
    if (taskObj.source !== 'native' && taskObj.source !== 'webview') {
      errors.push(
        `Long task at index ${i}: "source" must be "native" or "webview"`,
      );
    }
  }

  return errors;
}

/**
 * Validate metadata object
 */
function validateMetadata(metadata: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const field of REQUIRED_METADATA_FIELDS) {
    if (!(field in metadata)) {
      errors.push(`Missing required metadata field: ${field}`);
    }
  }

  if (
    metadata.timestamp !== undefined &&
    typeof metadata.timestamp !== 'string'
  ) {
    errors.push('Metadata field "timestamp" must be a string');
  }

  if (metadata.fpsTarget !== undefined) {
    if (typeof metadata.fpsTarget !== 'number' || metadata.fpsTarget <= 0) {
      errors.push('Metadata field "fpsTarget" must be a positive number');
    }
  }

  return errors;
}

/**
 * Type guard to check if an object is a valid NativeTraceFormat
 */
export function isNativeTraceFormat(obj: unknown): obj is NativeTraceFormat {
  const result = validateNativeTrace(obj);
  return result.valid;
}

/**
 * Parse and validate a JSON string as NativeTraceFormat
 *
 * @param json JSON string to parse
 * @returns Parsed trace or throws error with validation details
 */
export function parseNativeTrace(json: string): NativeTraceFormat {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
    );
  }

  const validation = validateNativeTrace(parsed);

  if (!validation.valid) {
    throw new Error(
      `Invalid native trace format:\n${validation.errors.join('\n')}`,
    );
  }

  return parsed as NativeTraceFormat;
}
