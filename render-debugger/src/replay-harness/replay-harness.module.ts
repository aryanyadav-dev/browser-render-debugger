/**
 * Replay Harness Module
 * Provides services for generating minimal HTML+script reproductions
 * of performance issues for local debugging
 */

import { Module } from '@nestjs/common';
import { ReplayHarnessService } from './replay-harness.service.js';

@Module({
  providers: [ReplayHarnessService],
  exports: [ReplayHarnessService],
})
export class ReplayHarnessModule {}
