import { Module } from '@nestjs/common';
import { ReporterService } from './reporter.service.js';
import { TerminalReporter } from './terminal.reporter.js';
import { JSONReporter } from './json.reporter.js';
import { HTMLReporter } from './html.reporter.js';

@Module({
  providers: [ReporterService, TerminalReporter, JSONReporter, HTMLReporter],
  exports: [ReporterService, TerminalReporter, JSONReporter, HTMLReporter],
})
export class ReporterModule {}
