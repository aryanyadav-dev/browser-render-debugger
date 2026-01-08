/**
 * Error types for render-debugger CLI
 *
 * Exit Code Strategy:
 * | Code Range | Category | Examples |
 * |------------|----------|----------|
 * | 0 | Success | Profile recorded, analysis complete |
 * | 1-9 | General errors | Unknown error, invalid arguments |
 * | 10-19 | CDP/Browser errors | Connection failed, invalid URL, harness crash |
 * | 20-29 | Git/Patch errors | Git required, patch failed |
 * | 30-39 | Trace errors | Parse failed, invalid format |
 * | 40-49 | Rule errors | Validation failed, threshold exceeded |
 * | 50-59 | CI failures | Severity threshold exceeded |
 */

export abstract class RenderDebuggerError extends Error {
  abstract readonly code: string;
  abstract readonly exitCode: number;
  abstract readonly recoverable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// General Errors (1-9)

export class UnknownError extends RenderDebuggerError {
  readonly code = 'UNKNOWN_ERROR';
  readonly exitCode = 1;
  readonly recoverable = false;

  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
  }
}

export class InvalidArgumentError extends RenderDebuggerError {
  readonly code = 'INVALID_ARGUMENT';
  readonly exitCode = 2;
  readonly recoverable = false;

  constructor(
    public readonly argument: string,
    public readonly reason: string,
  ) {
    super(`Invalid argument '${argument}': ${reason}`);
  }
}

// CDP/Browser Errors (10-19)

export class CDPConnectionError extends RenderDebuggerError {
  readonly code = 'CDP_CONNECTION_FAILED';
  readonly exitCode = 10;
  readonly recoverable = false;

  constructor(
    public readonly browserPath: string,
    public readonly port: number,
    public readonly cause?: Error,
  ) {
    super(`Failed to connect to browser at ${browserPath} on port ${port}`);
  }
}

export class InvalidURLError extends RenderDebuggerError {
  readonly code = 'INVALID_URL';
  readonly exitCode = 11;
  readonly recoverable = false;

  constructor(public readonly url: string) {
    super(`Invalid URL provided: ${url}`);
  }
}

export class HarnessError extends RenderDebuggerError {
  readonly code = 'HARNESS_CRASH';
  readonly exitCode = 12;
  readonly recoverable = false;

  constructor(
    public readonly scenario: string,
    public readonly cause?: Error,
  ) {
    super(`Scenario harness crashed: ${scenario}`);
  }
}

export class BrowserValidationError extends RenderDebuggerError {
  readonly code = 'BROWSER_VALIDATION_FAILED';
  readonly exitCode = 13;
  readonly recoverable = false;

  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`Browser validation failed for ${path}: ${reason}`);
  }
}

export class ScenarioNotFoundError extends RenderDebuggerError {
  readonly code = 'SCENARIO_NOT_FOUND';
  readonly exitCode = 14;
  readonly recoverable = false;

  constructor(public readonly scenario: string) {
    super(`Scenario not found: ${scenario}`);
  }
}

export class BrowserLaunchError extends RenderDebuggerError {
  readonly code = 'BROWSER_LAUNCH_FAILED';
  readonly exitCode = 15;
  readonly recoverable = false;

  constructor(
    public readonly browserPath: string,
    public readonly cause?: Error,
  ) {
    super(`Failed to launch browser at ${browserPath}`);
  }
}

// Git/Patch Errors (20-29)

export class GitRequiredError extends RenderDebuggerError {
  readonly code = 'GIT_REQUIRED';
  readonly exitCode = 20;
  readonly recoverable = false;

  constructor() {
    super(
      'Auto-apply requires a Git repository. Initialize git or use --dry-run.',
    );
  }
}

export class PatchApplicationError extends RenderDebuggerError {
  readonly code = 'PATCH_FAILED';
  readonly exitCode = 21;
  readonly recoverable = true;

  constructor(
    public readonly patchId: string,
    public readonly filePath: string,
    public readonly cause?: Error,
  ) {
    super(`Failed to apply patch ${patchId} to ${filePath}`);
  }
}

export class GitOperationError extends RenderDebuggerError {
  readonly code = 'GIT_OPERATION_FAILED';
  readonly exitCode = 22;
  readonly recoverable = false;

  constructor(
    public readonly operation: string,
    public readonly cause?: Error,
  ) {
    super(`Git operation failed: ${operation}`);
  }
}

export class DirtyWorkingTreeError extends RenderDebuggerError {
  readonly code = 'DIRTY_WORKING_TREE';
  readonly exitCode = 23;
  readonly recoverable = false;

  constructor() {
    super(
      'Working tree has uncommitted changes. Commit or stash changes before auto-apply.',
    );
  }
}

// Trace Errors (30-39)

export class TraceParseError extends RenderDebuggerError {
  readonly code = 'TRACE_PARSE_FAILED';
  readonly exitCode = 30;
  readonly recoverable = false;

  constructor(
    public readonly tracePath: string,
    public readonly cause?: Error,
  ) {
    super(`Failed to parse trace file: ${tracePath}`);
  }
}

export class TraceNotFoundError extends RenderDebuggerError {
  readonly code = 'TRACE_NOT_FOUND';
  readonly exitCode = 31;
  readonly recoverable = false;

  constructor(public readonly tracePath: string) {
    super(`Trace file not found: ${tracePath}`);
  }
}

export class InvalidTraceFormatError extends RenderDebuggerError {
  readonly code = 'INVALID_TRACE_FORMAT';
  readonly exitCode = 32;
  readonly recoverable = false;

  constructor(
    public readonly tracePath: string,
    public readonly reason: string,
  ) {
    super(`Invalid trace format in ${tracePath}: ${reason}`);
  }
}

// Rule Errors (40-49)

export class RuleValidationError extends RenderDebuggerError {
  readonly code = 'RULE_VALIDATION_FAILED';
  readonly exitCode = 40;
  readonly recoverable = true;

  constructor(
    public readonly rulePath: string,
    public readonly errors: string[],
  ) {
    super(`Rule validation failed: ${errors.join(', ')}`);
  }
}

export class RuleNotFoundError extends RenderDebuggerError {
  readonly code = 'RULE_NOT_FOUND';
  readonly exitCode = 41;
  readonly recoverable = false;

  constructor(public readonly ruleId: string) {
    super(`Rule not found: ${ruleId}`);
  }
}

// CI Failures (50-59)

export class SeverityThresholdExceededError extends RenderDebuggerError {
  readonly code = 'SEVERITY_THRESHOLD_EXCEEDED';
  readonly exitCode = 50;
  readonly recoverable = false;

  constructor(
    public readonly threshold: string,
    public readonly violations: number,
  ) {
    super(`${violations} issue(s) exceeded severity threshold: ${threshold}`);
  }
}

export class RegressionDetectedError extends RenderDebuggerError {
  readonly code = 'REGRESSION_DETECTED';
  readonly exitCode = 51;
  readonly recoverable = false;

  constructor(
    public readonly regressionCount: number,
    public readonly severity: string,
  ) {
    super(
      `${regressionCount} regression(s) detected at severity level: ${severity}`,
    );
  }
}
