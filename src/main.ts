#!/usr/bin/env node
/**
 * render-debugger CLI Entry Point
 *
 * This is the main entry point for the render-debugger CLI tool.
 * It bootstraps the NestJS application using nest-commander for CLI functionality.
 *
 * Usage:
 *   render-debugger init --browser-path <path>
 *   render-debugger profile --url <url> --scenario <scenario>
 *   render-debugger analyze <trace.json> --name <name>
 *   render-debugger compare <base.json> <head.json>
 *   render-debugger fix <trace.json> [--dry-run | --auto-apply]
 *   render-debugger monitor --url <url> --scenario <scenario>
 *   render-debugger rules list
 *   render-debugger rules validate
 *
 * Exit Codes:
 *   0: Success
 *   1-9: General errors
 *   10-19: CDP/Browser errors
 *   20-29: Git/Patch errors
 *   30-39: Trace errors
 *   40-49: Rule errors
 *   50-59: CI failures (severity threshold exceeded)
 *
 * Requirements: 12.1
 */

import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module.js';

/**
 * Bootstrap the CLI application
 */
async function bootstrap(): Promise<void> {
  try {
    await CommandFactory.run(AppModule, ['warn', 'error']);
  } catch (error: unknown) {
    // Handle specific error types with appropriate exit codes
    if (error instanceof Error) {
      // Check for known error types
      const errorWithCode = error as Error & { exitCode?: number };
      if (typeof errorWithCode.exitCode === 'number') {
        console.error(`Error: ${error.message}`);
        process.exit(errorWithCode.exitCode);
      }
    }

    // Generic error handling
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

bootstrap();
