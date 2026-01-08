/**
 * Compare Module
 * Provides trace comparison functionality for identifying regressions and improvements
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import { Module } from '@nestjs/common';
import { CompareService } from './compare.service.js';

@Module({
  providers: [CompareService],
  exports: [CompareService],
})
export class CompareModule {}
