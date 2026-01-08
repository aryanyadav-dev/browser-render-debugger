/**
 * Error recovery strategies for render-debugger
 */

import { RenderDebuggerError } from './error-types.js';

export interface ErrorRecoveryStrategy {
  shouldRetry(error: RenderDebuggerError): boolean;
  maxRetries: number;
  backoffMs: number;
  onRetry?(attempt: number, error: RenderDebuggerError): void;
}

export const CDP_RECOVERY: ErrorRecoveryStrategy = {
  shouldRetry: (error) => error.code === 'CDP_CONNECTION_FAILED',
  maxRetries: 3,
  backoffMs: 1000,
  onRetry: (attempt) => {
    console.log(`Retrying CDP connection (attempt ${attempt})...`);
  },
};

export const PATCH_RECOVERY: ErrorRecoveryStrategy = {
  shouldRetry: (error) => error.code === 'PATCH_FAILED' && error.recoverable,
  maxRetries: 1,
  backoffMs: 0,
  onRetry: () => {
    console.log('Attempting alternative patch strategy...');
  },
};

export const TRACE_RECOVERY: ErrorRecoveryStrategy = {
  shouldRetry: (error) => error.code === 'TRACE_PARSE_FAILED',
  maxRetries: 1,
  backoffMs: 0,
  onRetry: () => {
    console.log('Attempting to parse trace with fallback parser...');
  },
};

/**
 * Execute an operation with retry logic based on recovery strategy
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  strategy: ErrorRecoveryStrategy,
): Promise<T> {
  let lastError: RenderDebuggerError | null = null;
  let attempt = 0;

  while (attempt <= strategy.maxRetries) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RenderDebuggerError)) {
        throw error;
      }

      lastError = error;

      if (!strategy.shouldRetry(error) || attempt >= strategy.maxRetries) {
        throw error;
      }

      attempt++;
      strategy.onRetry?.(attempt, error);

      if (strategy.backoffMs > 0) {
        await sleep(strategy.backoffMs * attempt);
      }
    }
  }

  // This should never be reached since we throw in the catch block,
  // but TypeScript needs this for type safety
  if (lastError) {
    throw lastError;
  }
  throw new Error('Unexpected retry loop exit without error');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map error to exit code
 */
export function getExitCode(error: unknown): number {
  if (error instanceof RenderDebuggerError) {
    return error.exitCode;
  }
  return 1; // Unknown error
}

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof RenderDebuggerError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
