import { Module } from '@nestjs/common';
import { RollingWindowService } from './rolling-window.service.js';
import { MonitorService } from './monitor.service.js';
import { CdpModule } from '../cdp/cdp.module.js';
import { RecorderModule } from '../recorder/recorder.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { ServicesModule } from '../services/services.module.js';

@Module({
  imports: [CdpModule, RecorderModule, RulesModule, ServicesModule],
  providers: [RollingWindowService, MonitorService],
  exports: [RollingWindowService, MonitorService],
})
export class MonitorModule {}
