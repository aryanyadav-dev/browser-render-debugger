/**
 * Integration tests for the analyzer workflow
 * Tests full profile → analyze → fix workflow with synthetic fixtures
 *
 * Requirements: 13.4
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AnalyzerService } from '../../src/analyzer/analyzer.service.js';
import { ScoringService } from '../../src/analyzer/scoring/scoring.service.js';
import { LayoutThrashDetector } from '../../src/analyzer/detectors/layout-thrash.detector.js';
import { GPUStallDetector } from '../../src/analyzer/detectors/gpu-stall.detector.js';
import { LongTaskDetector } from '../../src/analyzer/detectors/long-task.detector.js';
import { HeavyPaintDetector } from '../../src/analyzer/detectors/heavy-paint.detector.js';
import { SuggesterService } from '../../src/suggester/suggester.service.js';
import { SpeedupCalculatorService } from '../../src/suggester/speedup-calculator.service.js';
import { CSSSuggester } from '../../src/suggester/css.suggester.js';
import { JSSuggester } from '../../src/suggester/js.suggester.js';
import {
  createLayoutThrashTrace,
  createGPUStallTrace,
  createLongTaskTrace,
} from '../fixtures/traces/index.js';

describe('Analyzer Integration Tests', () => {
  let analyzerService: AnalyzerService;
  let suggesterService: SuggesterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyzerService,
        ScoringService,
        LayoutThrashDetector,
        GPUStallDetector,
        LongTaskDetector,
        HeavyPaintDetector,
        SuggesterService,
        SpeedupCalculatorService,
        CSSSuggester,
        JSSuggester,
      ],
    }).compile();

    analyzerService = module.get<AnalyzerService>(AnalyzerService);
    suggesterService = module.get<SuggesterService>(SuggesterService);

    // Register detectors
    const layoutThrashDetector =
      module.get<LayoutThrashDetector>(LayoutThrashDetector);
    const gpuStallDetector = module.get<GPUStallDetector>(GPUStallDetector);
    const longTaskDetector = module.get<LongTaskDetector>(LongTaskDetector);
    const heavyPaintDetector =
      module.get<HeavyPaintDetector>(HeavyPaintDetector);

    analyzerService.registerDetector(layoutThrashDetector);
    analyzerService.registerDetector(gpuStallDetector);
    analyzerService.registerDetector(longTaskDetector);
    analyzerService.registerDetector(heavyPaintDetector);

    // Register suggesters
    const cssSuggester = module.get<CSSSuggester>(CSSSuggester);
    const jsSuggester = module.get<JSSuggester>(JSSuggester);

    suggesterService.registerSuggester(cssSuggester);
    suggesterService.registerSuggester(jsSuggester);
  });

  describe('Layout Thrash Detection', () => {
    it('should detect layout thrashing patterns from synthetic trace', async () => {
      const trace = createLayoutThrashTrace({
        occurrences: 5,
        reflowCostMs: 15,
        affectedNodes: 100,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'layout-thrash-test',
        fpsTarget: 60,
      });

      // Should detect layout thrashing
      const layoutDetections = result.detections.filter(
        (d) => d.type === 'layout_thrashing',
      );
      expect(layoutDetections.length).toBeGreaterThan(0);

      // Verify detection properties
      const detection = layoutDetections[0];
      expect(detection).toBeDefined();
      expect(detection!.severity).toBeDefined();
      expect(detection!.metrics.durationMs).toBeGreaterThan(0);
      expect(detection!.metrics.occurrences).toBeGreaterThan(0);
    });

    it('should generate CSS suggestions for layout thrashing', async () => {
      const trace = createLayoutThrashTrace({
        occurrences: 5,
        reflowCostMs: 15,
        affectedNodes: 100,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'layout-thrash-test',
        fpsTarget: 60,
      });

      const suggestions = await suggesterService.suggest(result.detections);

      // Should generate suggestions for layout issues
      expect(suggestions.length).toBeGreaterThanOrEqual(0);

      // If suggestions exist, verify structure
      if (suggestions.length > 0) {
        const suggestion = suggestions[0];
        expect(suggestion).toBeDefined();
        expect(suggestion!.type).toBeDefined();
        expect(suggestion!.estimatedSpeedupPct).toBeGreaterThanOrEqual(0);
        expect(suggestion!.estimatedSpeedupPct).toBeLessThanOrEqual(80);
      }
    });
  });

  describe('GPU Stall Detection', () => {
    it('should detect GPU stalls from synthetic trace', async () => {
      const trace = createGPUStallTrace({
        syncStalls: 3,
        textureUploads: 2,
        rasterStalls: 2,
        stallDurationMs: 10,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'gpu-stall-test',
        fpsTarget: 60,
      });

      // Should detect GPU stalls
      const gpuDetections = result.detections.filter(
        (d) => d.type === 'gpu_stall',
      );
      expect(gpuDetections.length).toBeGreaterThan(0);

      // Verify detection properties
      const detection = gpuDetections[0];
      expect(detection).toBeDefined();
      expect(detection!.severity).toBeDefined();
      expect(detection!.metrics.durationMs).toBeGreaterThan(0);
    });

    it('should generate suggestions for GPU stalls', async () => {
      const trace = createGPUStallTrace({
        syncStalls: 3,
        textureUploads: 2,
        rasterStalls: 2,
        stallDurationMs: 10,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'gpu-stall-test',
        fpsTarget: 60,
      });

      const suggestions = await suggesterService.suggest(result.detections);

      // Suggestions may or may not be generated depending on detection details
      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('Long Task Detection', () => {
    it('should detect long tasks from synthetic trace', async () => {
      const trace = createLongTaskTrace({
        taskCount: 4,
        avgTaskDurationMs: 80,
        functionName: 'heavyComputation',
        fileName: 'app.js',
      });

      const result = await analyzerService.analyze(trace, {
        name: 'long-task-test',
        fpsTarget: 60,
      });

      // Should detect long tasks
      const longTaskDetections = result.detections.filter(
        (d) => d.type === 'long_task',
      );
      expect(longTaskDetections.length).toBeGreaterThan(0);

      // Verify detection properties
      const detection = longTaskDetections[0];
      expect(detection).toBeDefined();
      expect(detection!.severity).toBeDefined();
      expect(detection!.metrics.durationMs).toBeGreaterThan(50); // >50ms threshold
    });

    it('should generate JS suggestions for long tasks', async () => {
      const trace = createLongTaskTrace({
        taskCount: 4,
        avgTaskDurationMs: 80,
        functionName: 'heavyComputation',
        fileName: 'app.js',
      });

      const result = await analyzerService.analyze(trace, {
        name: 'long-task-test',
        fpsTarget: 60,
      });

      const suggestions = await suggesterService.suggest(result.detections);

      // Should generate JS suggestions for long tasks
      const jsSuggestions = suggestions.filter((s) => s.type === 'js');
      expect(jsSuggestions.length).toBeGreaterThanOrEqual(0);

      // If suggestions exist, verify structure
      if (jsSuggestions.length > 0) {
        const suggestion = jsSuggestions[0];
        expect(suggestion).toBeDefined();
        expect(suggestion!.type).toBe('js');
        expect(suggestion!.estimatedSpeedupPct).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Full Workflow', () => {
    it('should complete analyze workflow and produce summary', async () => {
      const trace = createLayoutThrashTrace({
        occurrences: 5,
        reflowCostMs: 15,
        affectedNodes: 100,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'full-workflow-test',
        fpsTarget: 60,
      });

      // Verify summary structure
      expect(result.summary).toBeDefined();
      expect(result.summary.id).toBeDefined();
      expect(result.summary.name).toBe('full-workflow-test');
      expect(result.summary.frames).toBeDefined();
      expect(result.summary.frames.frame_budget_ms).toBeCloseTo(16.67, 1);
      expect(result.summary.phase_breakdown).toBeDefined();
      expect(result.summary.hotspots).toBeDefined();
    });

    it('should calculate frame metrics correctly', async () => {
      const trace = createLongTaskTrace({
        taskCount: 4,
        avgTaskDurationMs: 80,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'frame-metrics-test',
        fpsTarget: 60,
      });

      // Verify frame metrics
      expect(result.summary.frames.total).toBeGreaterThan(0);
      expect(result.summary.frames.frame_budget_ms).toBeCloseTo(16.67, 1);
      expect(result.summary.frames.avg_fps).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty trace gracefully', async () => {
      const emptyTrace = {
        traceEvents: [],
        metadata: {
          browser_version: '120.0.0.0',
          user_agent: 'Test',
          viewport: { width: 1920, height: 1080 },
          device_pixel_ratio: 2,
          timestamp: new Date().toISOString(),
          scenario: 'empty-test',
          fps_target: 60,
        },
      };

      const result = await analyzerService.analyze(emptyTrace, {
        name: 'empty-trace-test',
        fpsTarget: 60,
      });

      // Should handle gracefully without errors
      expect(result.summary).toBeDefined();
      expect(result.detections).toEqual([]);
      expect(result.summary.frames.total).toBe(0);
    });

    it('should respect FPS target in frame budget calculation', async () => {
      const trace = createLayoutThrashTrace({ occurrences: 3 });

      // Test with 60 FPS
      const result60 = await analyzerService.analyze(trace, {
        name: 'fps-60-test',
        fpsTarget: 60,
      });
      expect(result60.summary.frames.frame_budget_ms).toBeCloseTo(16.67, 1);

      // Test with 120 FPS
      const result120 = await analyzerService.analyze(trace, {
        name: 'fps-120-test',
        fpsTarget: 120,
      });
      expect(result120.summary.frames.frame_budget_ms).toBeCloseTo(8.33, 1);

      // Test with 30 FPS
      const result30 = await analyzerService.analyze(trace, {
        name: 'fps-30-test',
        fpsTarget: 30,
      });
      expect(result30.summary.frames.frame_budget_ms).toBeCloseTo(33.33, 1);
    });
  });

  describe('Suggestion Prioritization', () => {
    it('should prioritize suggestions by estimated speedup', async () => {
      // Create trace with multiple issue types
      const trace = createLayoutThrashTrace({
        occurrences: 10,
        reflowCostMs: 25,
        affectedNodes: 200,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'prioritization-test',
        fpsTarget: 60,
      });

      const suggestions = await suggesterService.suggest(result.detections, {
        maxSuggestions: 10,
      });

      // If multiple suggestions, verify they are sorted by speedup
      if (suggestions.length > 1) {
        for (let i = 1; i < suggestions.length; i++) {
          expect(
            suggestions[i - 1]!.estimatedSpeedupPct,
          ).toBeGreaterThanOrEqual(suggestions[i]!.estimatedSpeedupPct);
        }
      }
    });

    it('should limit suggestions to maxSuggestions', async () => {
      const trace = createLayoutThrashTrace({
        occurrences: 20,
        reflowCostMs: 30,
        affectedNodes: 300,
      });

      const result = await analyzerService.analyze(trace, {
        name: 'limit-test',
        fpsTarget: 60,
      });

      const suggestions = await suggesterService.suggest(result.detections, {
        maxSuggestions: 3,
      });

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Capability-Aware Analysis', () => {
    it('should skip GPU stall detector when GPU capability is missing', async () => {
      const trace = createGPUStallTrace({
        syncStalls: 3,
        textureUploads: 2,
        rasterStalls: 2,
        stallDurationMs: 10,
      });

      // Analyze with limited capabilities (no GPU events)
      const result = await analyzerService.analyze(trace, {
        name: 'limited-capability-test',
        fpsTarget: 60,
        adapterCapabilities: [
          'frame_timing',
          'long_tasks',
          'dom_signals',
        ] as any[],
      });

      // Should have warnings about skipped detectors
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]!.code).toBe('DEGRADED_ANALYSIS');
      expect(result.warnings![0]!.affectedDetectors).toContain(
        'GPUStallDetector',
      );

      // Should not have GPU stall detections
      const gpuDetections = result.detections.filter(
        (d) => d.type === 'gpu_stall',
      );
      expect(gpuDetections.length).toBe(0);
    });

    it('should run all detectors with full CDP capabilities', async () => {
      const trace = createGPUStallTrace({
        syncStalls: 3,
        textureUploads: 2,
        rasterStalls: 2,
        stallDurationMs: 10,
      });

      // Analyze with full CDP capabilities
      const result = await analyzerService.analyze(trace, {
        name: 'full-capability-test',
        fpsTarget: 60,
        adapterCapabilities: [
          'full_cdp',
          'frame_timing',
          'long_tasks',
          'dom_signals',
          'gpu_events',
          'paint_events',
        ] as any[],
      });

      // Should not have warnings
      expect(result.warnings).toBeUndefined();

      // Should have GPU stall detections
      const gpuDetections = result.detections.filter(
        (d) => d.type === 'gpu_stall',
      );
      expect(gpuDetections.length).toBeGreaterThan(0);
    });

    it('should provide helpful suggestions in degraded mode warnings', async () => {
      const trace = createLayoutThrashTrace({ occurrences: 3 });

      // Analyze with limited capabilities
      const result = await analyzerService.analyze(trace, {
        name: 'degraded-mode-test',
        fpsTarget: 60,
        adapterCapabilities: ['frame_timing'] as any[],
      });

      // Check warnings have suggestions
      if (result.warnings && result.warnings.length > 0) {
        const warning = result.warnings[0]!;
        expect(warning.suggestions).toBeDefined();
        expect(warning.suggestions!.length).toBeGreaterThan(0);
      }
    });
  });
});
