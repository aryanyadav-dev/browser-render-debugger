import { Module } from '@nestjs/common';
import { GitService } from './git.service.js';
import { PatchGeneratorService } from './patch-generator.service.js';
import { DryRunService } from './dry-run.service.js';
import { AutoApplyService } from './auto-apply.service.js';
import { PatcherService } from './patcher.service.js';
import { FixTargetFilterService } from './fix-target-filter.service.js';
import { ServicesModule } from '../services/services.module.js';

@Module({
  imports: [ServicesModule],
  providers: [
    GitService,
    PatchGeneratorService,
    DryRunService,
    AutoApplyService,
    PatcherService,
    FixTargetFilterService,
  ],
  exports: [
    GitService,
    PatchGeneratorService,
    DryRunService,
    AutoApplyService,
    PatcherService,
    FixTargetFilterService,
  ],
})
export class PatcherModule {}
