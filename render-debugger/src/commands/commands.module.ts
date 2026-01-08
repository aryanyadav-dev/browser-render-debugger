import { Module } from '@nestjs/common';
import { InitCommand } from './init.command.js';
import { ProfileCommand } from './profile.command.js';
import { AnalyzeCommand } from './analyze.command.js';
import { CompareCommand } from './compare.command.js';
import {
  RulesCommand,
  RulesListCommand,
  RulesValidateCommand,
} from './rules.command.js';
import { FixCommand } from './fix.command.js';
import { MonitorCommand } from './monitor.command.js';
import { RecorderModule } from '../recorder/recorder.module.js';
import { AnalyzerModule } from '../analyzer/analyzer.module.js';
import { SuggesterModule } from '../suggester/suggester.module.js';
import { ReporterModule } from '../reporter/reporter.module.js';
import { CompareModule } from '../compare/compare.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { PatcherModule } from '../patcher/patcher.module.js';
import { MonitorModule } from '../monitor/monitor.module.js';
import { ReplayHarnessModule } from '../replay-harness/replay-harness.module.js';

@Module({
  imports: [
    RecorderModule,
    AnalyzerModule,
    SuggesterModule,
    ReporterModule,
    CompareModule,
    RulesModule,
    PatcherModule,
    MonitorModule,
    ReplayHarnessModule,
  ],
  providers: [
    InitCommand,
    ProfileCommand,
    AnalyzeCommand,
    CompareCommand,
    RulesCommand,
    RulesListCommand,
    RulesValidateCommand,
    FixCommand,
    MonitorCommand,
  ],
})
export class CommandsModule {}
