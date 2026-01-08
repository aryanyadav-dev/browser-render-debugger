/**
 * Application Root Module
 *
 * The AppModule is the root module of the render-debugger CLI application.
 * It orchestrates all feature modules and establishes the dependency injection
 * container for the entire application.
 *
 * Module Architecture:
 * - ServicesModule: Global shared services (storage, config, browser validation, etc.)
 * - AdaptersModule: Browser adapter infrastructure (CDP, WebKit native)
 * - CommandsModule: CLI commands (init, profile, analyze, compare, fix, monitor, rules)
 *
 * The CommandsModule internally imports all feature modules:
 * - RecorderModule: CDP connection and trace recording
 * - AnalyzerModule: Performance issue detection
 * - SuggesterModule: Fix recommendation generation
 * - ReporterModule: Terminal, JSON, and HTML report generation
 * - CompareModule: Trace comparison and regression detection
 * - RulesModule: Performance threshold management
 * - PatcherModule: Patch generation and application
 * - MonitorModule: Continuous performance monitoring
 * - ReplayHarnessModule: Issue reproduction export
 *
 * Requirements: 12.1, 12.6
 */

import { Module } from '@nestjs/common';
import { ServicesModule } from './services/services.module.js';
import { CommandsModule } from './commands/commands.module.js';
import { AdaptersModule } from './adapters/adapters.module.js';

@Module({
  imports: [
    // Global shared services - must be imported first
    ServicesModule,

    // Browser adapter infrastructure for multi-platform support
    AdaptersModule,

    // CLI commands and feature modules
    CommandsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
