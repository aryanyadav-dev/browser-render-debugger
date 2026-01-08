/**
 * Unit tests for ReplayHarnessService
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ReplayHarnessService } from './replay-harness.service.js';
import { StorageService } from '../services/storage.service.js';
import type {
  Detection,
  TraceSummary,
  LayoutThrashDetection,
  GPUStallDetection,
  LongTaskDetection,
  HeavyPaintDetection,
} from '../shared/types/index.js';

describe('ReplayHarnessService', () => {
  let service: ReplayHarnessService;
  let storageService: jest.Mocked<StorageService>;

  const mockTraceSummary: TraceSummary = {
    id: 'test-123',
    name: 'test-analysis',
    url: 'http://localhost:3000',
    duration_ms: 5000,
    frames: {
      total: 300,
      dropped: 15,
      avg_fps: 58.5,
      frame_budget_ms: 16.67,
    },
    phase_breakdown: {
      style_recalc_ms: 50,
      layout_ms: 100,
      paint_ms: 75,
      composite_ms: 25,
      gpu_ms: 30,
    },
    hotspots: {
      layout_thrashing: [],
      gpu_stalls: [],
      long_tasks: [],
    },
    suggestions: [],
    metadata: {
      browser_version: '120.0.0',
      user_agent: 'Chrome/120',
      viewport: { width: 1920, height: 1080 },
      device_pixel_ratio: 1,
      timestamp: new Date().toISOString(),
      scenario: 'test-scenario',
      fps_target: 60,
    },
  };

  beforeEach(async () => {
    const mockStorageService = {
      writeReport: jest.fn().mockResolvedValue('/path/to/harness.html'),
      getReportsDir: jest.fn().mockReturnValue('.render-debugger/reports'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplayHarnessService,
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
      ],
    }).compile();

    service = module.get<ReplayHarnessService>(ReplayHarnessService);
    storageService = module.get(StorageService);
  });

  describe('generateHarness', () => {
    it('should generate empty harness when no detections', () => {
      const result = service.generateHarness([], mockTraceSummary, {
        name: 'test',
      });

      expect(result.html).toContain('No Performance Issues Detected');
      expect(result.includedDetectionTypes).toHaveLength(0);
      expect(result.summary).toBe('No detections to reproduce');
    });

    it('should generate harness with layout thrash detection', () => {
      const detection: LayoutThrashDetection = {
        type: 'layout_thrashing',
        severity: 'high',
        description: 'Layout thrashing detected',
        location: { selector: '.card' },
        metrics: { durationMs: 50, occurrences: 10, impactScore: 80 },
        evidence: [],
        selector: '.card',
        reflowCostMs: 50,
        occurrences: 10,
        affectedNodes: 5,
        readWritePattern: [],
      };

      const result = service.generateHarness([detection], mockTraceSummary, {
        name: 'test',
      });

      expect(result.html).toContain('layout_thrashing');
      expect(result.html).toContain('.card');
      expect(result.html).toContain('thrashLayout');
      expect(result.includedDetectionTypes).toContain('layout_thrashing');
    });

    it('should generate harness with GPU stall detection', () => {
      const detection: GPUStallDetection = {
        type: 'gpu_stall',
        severity: 'warning',
        description: 'GPU stall detected',
        location: { element: 'svg' },
        metrics: { durationMs: 100, occurrences: 5, impactScore: 60 },
        evidence: [],
        element: 'svg',
        stallMs: 100,
        occurrences: 5,
        stallType: 'sync',
      };

      const result = service.generateHarness([detection], mockTraceSummary, {
        name: 'test',
      });

      expect(result.html).toContain('gpu_stall');
      expect(result.html).toContain('heavyGPUWork');
      expect(result.includedDetectionTypes).toContain('gpu_stall');
    });

    it('should generate harness with long task detection', () => {
      const detection: LongTaskDetection = {
        type: 'long_task',
        severity: 'high',
        description: 'Long task detected',
        location: { file: 'app.js', line: 42 },
        metrics: { durationMs: 150, occurrences: 3, impactScore: 90 },
        evidence: [],
        functionName: 'processData',
        file: 'app.js',
        line: 42,
        column: 10,
        cpuMs: 150,
        occurrences: 3,
        correlatedFrameDrops: 5,
        callStack: [],
      };

      const result = service.generateHarness([detection], mockTraceSummary, {
        name: 'test',
      });

      expect(result.html).toContain('long_task');
      expect(result.html).toContain('processData');
      expect(result.html).toContain('150');
      expect(result.includedDetectionTypes).toContain('long_task');
    });

    it('should generate harness with heavy paint detection', () => {
      const detection: HeavyPaintDetection = {
        type: 'heavy_paint',
        severity: 'warning',
        description: 'Heavy paint detected',
        location: {},
        metrics: { durationMs: 80, occurrences: 20, impactScore: 70 },
        evidence: [],
        paintTimeMs: 50,
        rasterTimeMs: 30,
        layerCount: 15,
      };

      const result = service.generateHarness([detection], mockTraceSummary, {
        name: 'test',
      });

      expect(result.html).toContain('heavy_paint');
      expect(result.html).toContain('paint-heavy');
      expect(result.includedDetectionTypes).toContain('heavy_paint');
    });

    it('should include all detections when includeAllDetections is true', () => {
      const detections: Detection[] = [
        {
          type: 'layout_thrashing',
          severity: 'high',
          description: 'Layout thrashing',
          location: { selector: '.card' },
          metrics: { durationMs: 50, occurrences: 10, impactScore: 80 },
          evidence: [],
          selector: '.card',
          reflowCostMs: 50,
          occurrences: 10,
          affectedNodes: 5,
          readWritePattern: [],
        } as LayoutThrashDetection,
        {
          type: 'long_task',
          severity: 'high',
          description: 'Long task',
          location: { file: 'app.js', line: 42 },
          metrics: { durationMs: 150, occurrences: 3, impactScore: 90 },
          evidence: [],
          functionName: 'processData',
          file: 'app.js',
          line: 42,
          column: 10,
          cpuMs: 150,
          occurrences: 3,
          correlatedFrameDrops: 5,
          callStack: [],
        } as LongTaskDetection,
      ];

      const result = service.generateHarness(detections, mockTraceSummary, {
        name: 'test',
        includeAllDetections: true,
      });

      expect(result.includedDetectionTypes).toContain('layout_thrashing');
      expect(result.includedDetectionTypes).toContain('long_task');
    });

    it('should only include first detection when includeAllDetections is false', () => {
      const detections: Detection[] = [
        {
          type: 'layout_thrashing',
          severity: 'high',
          description: 'Layout thrashing',
          location: { selector: '.card' },
          metrics: { durationMs: 50, occurrences: 10, impactScore: 80 },
          evidence: [],
          selector: '.card',
          reflowCostMs: 50,
          occurrences: 10,
          affectedNodes: 5,
          readWritePattern: [],
        } as LayoutThrashDetection,
        {
          type: 'long_task',
          severity: 'high',
          description: 'Long task',
          location: { file: 'app.js', line: 42 },
          metrics: { durationMs: 150, occurrences: 3, impactScore: 90 },
          evidence: [],
          functionName: 'processData',
          file: 'app.js',
          line: 42,
          column: 10,
          cpuMs: 150,
          occurrences: 3,
          correlatedFrameDrops: 5,
          callStack: [],
        } as LongTaskDetection,
      ];

      const result = service.generateHarness(detections, mockTraceSummary, {
        name: 'test',
        includeAllDetections: false,
      });

      expect(result.includedDetectionTypes).toHaveLength(1);
      expect(result.includedDetectionTypes).toContain('layout_thrashing');
    });

    it('should include performance measurement when requested', () => {
      const detection: LayoutThrashDetection = {
        type: 'layout_thrashing',
        severity: 'high',
        description: 'Layout thrashing detected',
        location: { selector: '.card' },
        metrics: { durationMs: 50, occurrences: 10, impactScore: 80 },
        evidence: [],
        selector: '.card',
        reflowCostMs: 50,
        occurrences: 10,
        affectedNodes: 5,
        readWritePattern: [],
      };

      const result = service.generateHarness([detection], mockTraceSummary, {
        name: 'test',
        includePerformanceMeasurement: true,
      });

      expect(result.html).toContain('PerformanceObserver');
      expect(result.html).toContain('measureFrame');
    });
  });

  describe('generateAndSaveHarness', () => {
    it('should save harness to disk and return file path', async () => {
      const detection: LayoutThrashDetection = {
        type: 'layout_thrashing',
        severity: 'high',
        description: 'Layout thrashing detected',
        location: { selector: '.card' },
        metrics: { durationMs: 50, occurrences: 10, impactScore: 80 },
        evidence: [],
        selector: '.card',
        reflowCostMs: 50,
        occurrences: 10,
        affectedNodes: 5,
        readWritePattern: [],
      };

      const result = await service.generateAndSaveHarness(
        [detection],
        mockTraceSummary,
        { name: 'test' },
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(storageService.writeReport).toHaveBeenCalled();
      expect(result.filePath).toBe('/path/to/harness.html');
    });
  });

  describe('generateReproduction', () => {
    it('should generate layout thrash reproduction', () => {
      const detection: LayoutThrashDetection = {
        type: 'layout_thrashing',
        severity: 'high',
        description: 'Layout thrashing detected',
        location: { selector: '.card' },
        metrics: { durationMs: 50, occurrences: 10, impactScore: 80 },
        evidence: [],
        selector: '.card',
        reflowCostMs: 50,
        occurrences: 10,
        affectedNodes: 5,
        readWritePattern: [],
      };

      const generateReproduction = service.generateReproduction.bind(service);
      const reproduction = generateReproduction(detection);

      expect(reproduction.type).toBe('layout_thrashing');
      expect(reproduction.script).toContain('thrashLayout');
      expect(reproduction.script).toContain('.card');
      expect(reproduction.comments).toContain('Original selector: .card');
    });

    it('should generate GPU stall reproduction', () => {
      const detection: GPUStallDetection = {
        type: 'gpu_stall',
        severity: 'warning',
        description: 'GPU stall detected',
        location: { element: 'svg' },
        metrics: { durationMs: 100, occurrences: 5, impactScore: 60 },
        evidence: [],
        element: 'svg',
        stallMs: 100,
        occurrences: 5,
        stallType: 'texture_upload',
      };

      const reproduction = service.generateReproduction(detection);

      expect(reproduction.type).toBe('gpu_stall');
      expect(reproduction.script).toContain('heavyGPUWork');
      expect(reproduction.comments).toContain('Stall type: texture_upload');
    });

    it('should generate long task reproduction', () => {
      const detection: LongTaskDetection = {
        type: 'long_task',
        severity: 'high',
        description: 'Long task detected',
        location: { file: 'app.js', line: 42 },
        metrics: { durationMs: 150, occurrences: 3, impactScore: 90 },
        evidence: [],
        functionName: 'heavyComputation',
        file: 'app.js',
        line: 42,
        column: 10,
        cpuMs: 150,
        occurrences: 3,
        correlatedFrameDrops: 5,
        callStack: [],
      };

      const reproduction = service.generateReproduction(detection);

      expect(reproduction.type).toBe('long_task');
      expect(reproduction.script).toContain('heavyComputation');
      expect(reproduction.script).toContain('150');
      expect(reproduction.comments).toContain(
        'Original function: heavyComputation',
      );
    });

    it('should generate heavy paint reproduction', () => {
      const detection: HeavyPaintDetection = {
        type: 'heavy_paint',
        severity: 'warning',
        description: 'Heavy paint detected',
        location: {},
        metrics: { durationMs: 80, occurrences: 20, impactScore: 70 },
        evidence: [],
        paintTimeMs: 50,
        rasterTimeMs: 30,
        layerCount: 15,
      };

      const reproduction = service.generateReproduction(detection);

      expect(reproduction.type).toBe('heavy_paint');
      expect(reproduction.script).toContain('triggerPaint');
      expect(reproduction.comments).toContain('Layer count: 15');
    });
  });
});
