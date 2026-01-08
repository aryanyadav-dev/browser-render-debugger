import { Module } from '@nestjs/common';
import { CDPConnectionService } from './cdp-connection.service.js';
import { TracingService } from './tracing.service.js';

@Module({
  providers: [CDPConnectionService, TracingService],
  exports: [CDPConnectionService, TracingService],
})
export class CdpModule {}
