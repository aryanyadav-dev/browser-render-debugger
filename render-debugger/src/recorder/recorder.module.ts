import { Module } from '@nestjs/common';
import { CdpModule } from '../cdp/cdp.module.js';
import { ScenarioRunnerService } from './scenario-runner.service.js';
import { RecorderService } from './recorder.service.js';

@Module({
  imports: [CdpModule],
  providers: [ScenarioRunnerService, RecorderService],
  exports: [ScenarioRunnerService, RecorderService],
})
export class RecorderModule {}
