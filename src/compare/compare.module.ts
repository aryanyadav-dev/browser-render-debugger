/**
 * Compare Module
 * Provides trace comparison functionality for identifying regressions and improvements
 *
 */

import { Module } from '@nestjs/common';
import { CompareService } from './compare.service.js';

@Module({
  providers: [CompareService],
  exports: [CompareService],
})
export class CompareModule {}
