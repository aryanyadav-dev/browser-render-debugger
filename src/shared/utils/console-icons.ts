/**
 * Console Icons Utility
 * Provides consistent success/failure icons for terminal output
 * Uses minimal icon set: ✓ (success), ● (failure/error), ⚠ (warning)
 */

export const ICONS = {
  // Status icons - minimal set
  success: '✓',
  failure: '●',
  warning: '⚠',
  info: '✓',

  // Action icons - mapped to minimal set
  loading: '...',
  done: '✓',
  error: '●',
  skip: '-',

  // Process icons - mapped to minimal set
  start: '✓',
  stop: '●',
  running: '...',

  // File icons - text-based
  file: '>',
  folder: '>',
  save: '✓',

  // Analysis icons - text-based
  analyze: '>',
  fix: '>',
  patch: '>',

  // Performance icons - text-based
  fast: '✓',
  slow: '●',
  improve: '✓',
  regress: '●',
};

/**
 * Log success message with tick icon
 */
export function logSuccess(message: string): void {
  console.log(`${ICONS.success} ${message}`);
}

/**
 * Log failure message with red dot icon
 */
export function logFailure(message: string): void {
  console.log(`${ICONS.failure} ${message}`);
}

/**
 * Log warning message
 */
export function logWarning(message: string): void {
  console.log(`${ICONS.warning} ${message}`);
}

/**
 * Log info message
 */
export function logInfo(message: string): void {
  console.log(`${ICONS.info} ${message}`);
}

/**
 * Log step with appropriate icon based on success
 */
export function logStep(message: string, success: boolean): void {
  const icon = success ? ICONS.success : ICONS.failure;
  console.log(`${icon} ${message}`);
}

/**
 * Format result with icon
 */
export function formatResult(message: string, success: boolean): string {
  const icon = success ? ICONS.success : ICONS.failure;
  return `${icon} ${message}`;
}
