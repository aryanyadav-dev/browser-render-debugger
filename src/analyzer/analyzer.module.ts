import { Module, OnModuleInit } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service.js';
import { LayoutThrashDetector } from './detectors/layout-thrash.detector.js';
import { GPUStallDetector } from './detectors/gpu-stall.detector.js';
import { LongTaskDetector } from './detectors/long-task.detector.js';
import { HeavyPaintDetector } from './detectors/heavy-paint.detector.js';
import { ScoringService } from './scoring/scoring.service.js';

@Module({
  providers: [
    AnalyzerService,
    ScoringService,
    LayoutThrashDetector,
    GPUStallDetector,
    LongTaskDetector,
    HeavyPaintDetector,
  ],
  exports: [AnalyzerService, ScoringService],
})
export class AnalyzerModule implements OnModuleInit {
  constructor(
    private readonly analyzerService: AnalyzerService,
    private readonly layoutThrashDetector: LayoutThrashDetector,
    private readonly gpuStallDetector: GPUStallDetector,
    private readonly longTaskDetector: LongTaskDetector,
    private readonly heavyPaintDetector: HeavyPaintDetector,
  ) {}

  onModuleInit() {
    // Register all detectors with the analyzer service
    this.analyzerService.registerDetector(this.layoutThrashDetector);
    this.analyzerService.registerDetector(this.gpuStallDetector);
    this.analyzerService.registerDetector(this.longTaskDetector);
    this.analyzerService.registerDetector(this.heavyPaintDetector);
  }
}
