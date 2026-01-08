/**
 * Integration tests for Swift/Native Adapter
 *
 * Tests the end-to-end flow:
 * Swift SDK trace format → webkit-native-adapter → analyze
 *
 * Requirements: 15.8, 15.9, 15.20, 15.21
 */

import { Test, TestingModule } from '@nestjs/testing';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WebKitNativeAdapter } from '../../src/adapters/webkit-native/webkit-native.adapter.js';
import { ChromiumCDPAdapter } from '../../src/adapters/chromium-cdp/chromium-cdp.adapter.js';
import { AdapterRegistryService } from '../../src/adapters/adapter-registry.service.js';
import { AnalyzerService } from '../../src/analyzer/analyzer.service.js';
import { ScoringService } from '../../src/analyzer/scoring/scoring.service.js';
import { LayoutThrashDetector } from '../../src/analyzer/detectors/layout-thrash.detector.js';
import { GPUStallDetector } from '../../src/analyzer/detectors/gpu-stall.detector.js';
import { LongTaskDetector } from '../../src/analyzer/detectors/long-task.detector.js';
import { HeavyPaintDetector } from '../../src/analyzer/detectors/heavy-paint.detector.js';
import type { NativeTraceFormat } from '../../src/adapters/webkit-native/schemas/native-trace.schema.js';
import { AdapterCapability } from '../../src/adapters/interfaces/browser-adapter.interface.js';
import type { TraceSnapshot } from '../../src/adapters/models/trace-snapshot.model.js';
import type {
  TraceData,
  TraceEvent,
  TraceMetadata,
} from '../../src/shared/types/trace.types.js';

describe('Swift/Native Adapter Integration Tests', () => {
  let adapterRegistry: AdapterRegistryService;
  let analyzerService: AnalyzerService;
  let testDir: string;

  beforeAll(async () => {
    // Create temp directory for test traces
    testDir = join(tmpdir(), `render-debugger-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdapterRegistryService,
        AnalyzerService,
        ScoringService,
        LayoutThrashDetector,
        GPUStallDetector,
        LongTaskDetector,
        HeavyPaintDetector,
      ],
    }).compile();

    adapterRegistry = module.get<AdapterRegistryService>(
      AdapterRegistryService,
    );
    analyzerService = module.get<AnalyzerService>(AnalyzerService);

    // Register adapters
    adapterRegistry.registerAdapter({
      metadata: new WebKitNativeAdapter().metadata,
      factory: () => new WebKitNativeAdapter(),
    });

    adapterRegistry.registerAdapter({
      metadata: new ChromiumCDPAdapter().metadata,
      factory: () => new ChromiumCDPAdapter(),
    });

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
  });

  describe('WebKit Native Adapter', () => {
    it('should be registered in adapter registry', () => {
      const adapters = adapterRegistry.getRegisteredAdapters();
      const webkitAdapter = adapters.find((a) => a.type === 'webkit-native');

      expect(webkitAdapter).toBeDefined();
      expect(webkitAdapter!.name).toBe('WebKit Native Adapter');
      expect(webkitAdapter!.capabilities).toContain(
        AdapterCapability.FRAME_TIMING,
      );
      expect(webkitAdapter!.capabilities).toContain(
        AdapterCapability.LONG_TASKS,
      );
    });

    it('should have correct capabilities (no GPU events)', () => {
      const adapters = adapterRegistry.getRegisteredAdapters();
      const webkitAdapter = adapters.find((a) => a.type === 'webkit-native');

      expect(webkitAdapter).toBeDefined();
      // WebKit native adapter should NOT have GPU events capability
      expect(webkitAdapter!.capabilities).not.toContain(
        AdapterCapability.GPU_EVENTS,
      );
      expect(webkitAdapter!.capabilities).not.toContain(
        AdapterCapability.FULL_CDP,
      );
    });

    it('should auto-detect webkit-native for Safari browser paths', () => {
      const detection = adapterRegistry.detectAdapter({
        browserPath: '/Applications/Safari.app/Contents/MacOS/Safari',
      });

      expect(detection.adapterType).toBe('webkit-native');
      expect(detection.confidence).toBe('high');
    });

    it('should auto-detect webkit-native for Safari browser hints', () => {
      const detection = adapterRegistry.detectAdapter({
        browserName: 'Safari',
      });

      expect(detection.adapterType).toBe('webkit-native');
      expect(detection.confidence).toBe('medium');
    });

    it('should auto-detect webkit-native for WebKit browser hints', () => {
      const detection = adapterRegistry.detectAdapter({
        browserName: 'WebKit',
      });

      expect(detection.adapterType).toBe('webkit-native');
      expect(detection.confidence).toBe('medium');
    });
  });

  describe('Chromium CDP Adapter', () => {
    it('should be registered in adapter registry', () => {
      const adapters = adapterRegistry.getRegisteredAdapters();
      const cdpAdapter = adapters.find((a) => a.type === 'chromium-cdp');

      expect(cdpAdapter).toBeDefined();
      expect(cdpAdapter!.name).toBe('Chromium CDP Adapter');
      expect(cdpAdapter!.capabilities).toContain(AdapterCapability.FULL_CDP);
      expect(cdpAdapter!.capabilities).toContain(AdapterCapability.GPU_EVENTS);
    });

    it('should auto-detect chromium-cdp for Chrome browser paths', () => {
      const detection = adapterRegistry.detectAdapter({
        browserPath:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      });

      expect(detection.adapterType).toBe('chromium-cdp');
      expect(detection.confidence).toBe('high');
    });

    it('should auto-detect chromium-cdp for Arc browser paths', () => {
      const detection = adapterRegistry.detectAdapter({
        browserPath: '/Applications/Arc.app/Contents/MacOS/Arc',
      });

      expect(detection.adapterType).toBe('chromium-cdp');
      expect(detection.confidence).toBe('high');
    });

    it('should auto-detect chromium-cdp for Dia browser paths', () => {
      const detection = adapterRegistry.detectAdapter({
        browserPath: '/Applications/Dia.app/Contents/MacOS/Dia',
      });

      expect(detection.adapterType).toBe('chromium-cdp');
      expect(detection.confidence).toBe('high');
    });

    it('should auto-detect chromium-cdp for Zen browser paths', () => {
      const detection = adapterRegistry.detectAdapter({
        browserPath: '/Applications/Zen.app/Contents/MacOS/Zen',
      });

      expect(detection.adapterType).toBe('chromium-cdp');
      expect(detection.confidence).toBe('high');
    });
  });

  describe('Swift SDK Trace Ingestion', () => {
    it('should ingest valid Swift SDK trace and normalize to TraceSnapshot', async () => {
      // Create a valid Swift SDK trace
      const swiftTrace: NativeTraceFormat = createValidSwiftTrace();
      const traceFile = join(testDir, 'swift-trace.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      // Create and connect adapter
      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });

      // Collect trace
      const snapshot = await adapter.collectTrace({
        name: 'swift-test',
        fpsTarget: 60,
      });

      // Verify snapshot structure
      expect(snapshot.id).toBeDefined();
      expect(snapshot.name).toBe('swift-test');
      expect(snapshot.frameTimings.length).toBe(swiftTrace.frames.length);
      expect(snapshot.longTasks.length).toBe(swiftTrace.longTasks.length);
      expect(snapshot.metadata.adapterType).toBe('webkit-native');
      expect(snapshot.metadata.platform).toBe('webkit');

      // Verify frame metrics
      expect(snapshot.frameMetrics).toBeDefined();
      expect(snapshot.frameMetrics.totalFrames).toBe(swiftTrace.frames.length);

      await adapter.disconnect();
    });

    it('should correctly identify dropped frames from Swift trace', async () => {
      // Create trace with dropped frames
      const swiftTrace = createSwiftTraceWithDroppedFrames();
      const traceFile = join(testDir, 'dropped-frames-trace.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });

      const snapshot = await adapter.collectTrace({
        name: 'dropped-frames-test',
        fpsTarget: 60,
      });

      // Verify dropped frames are detected
      const droppedFrames = snapshot.frameTimings.filter((f) => f.dropped);
      expect(droppedFrames.length).toBeGreaterThan(0);
      expect(snapshot.frameMetrics.droppedFrames).toBeGreaterThan(0);

      await adapter.disconnect();
    });

    it('should correctly convert long tasks from Swift trace', async () => {
      // Create trace with long tasks
      const swiftTrace = createSwiftTraceWithLongTasks();
      const traceFile = join(testDir, 'long-tasks-trace.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });

      const snapshot = await adapter.collectTrace({
        name: 'long-tasks-test',
        fpsTarget: 60,
      });

      // Verify long tasks are converted
      expect(snapshot.longTasks.length).toBe(swiftTrace.longTasks.length);
      expect(snapshot.longTasks[0]!.durationMs).toBeGreaterThan(50);
      expect(snapshot.longTasks[0]!.functionName).toBeDefined();

      await adapter.disconnect();
    });

    it('should have empty GPU events for native traces', async () => {
      const swiftTrace = createValidSwiftTrace();
      const traceFile = join(testDir, 'no-gpu-trace.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });

      const snapshot = await adapter.collectTrace({
        name: 'no-gpu-test',
        fpsTarget: 60,
      });

      // Native traces should not have GPU events
      expect(snapshot.gpuEvents).toEqual([]);
      expect(snapshot.paintEvents).toEqual([]);

      await adapter.disconnect();
    });
  });

  describe('End-to-End: Swift SDK → Adapter → Analyze', () => {
    it('should analyze Swift SDK trace and detect long tasks', async () => {
      // Create Swift trace with long tasks
      const swiftTrace = createSwiftTraceWithLongTasks();
      const traceFile = join(testDir, 'e2e-long-tasks.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      // Ingest via adapter
      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });
      const snapshot = await adapter.collectTrace({
        name: 'e2e-long-task-test',
        fpsTarget: 60,
      });
      await adapter.disconnect();

      // Convert snapshot to trace format for analyzer
      const traceData = convertSnapshotToTraceData(snapshot);

      // Analyze
      const result = await analyzerService.analyze(traceData, {
        name: 'e2e-long-task-analysis',
        fpsTarget: 60,
        adapterCapabilities: adapter.metadata.capabilities as any[],
      });

      // Verify analysis results
      expect(result.summary).toBeDefined();
      expect(result.summary.name).toBe('e2e-long-task-analysis');

      // Should detect long tasks
      const longTaskDetections = result.detections.filter(
        (d) => d.type === 'long_task',
      );
      expect(longTaskDetections.length).toBeGreaterThan(0);
    });

    it('should skip GPU stall detection for native traces (degraded mode)', async () => {
      const swiftTrace = createValidSwiftTrace();
      const traceFile = join(testDir, 'e2e-degraded.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });
      const snapshot = await adapter.collectTrace({
        name: 'e2e-degraded-test',
        fpsTarget: 60,
      });
      await adapter.disconnect();

      const traceData = convertSnapshotToTraceData(snapshot);

      // Analyze with webkit-native capabilities (no GPU events)
      const result = await analyzerService.analyze(traceData, {
        name: 'e2e-degraded-analysis',
        fpsTarget: 60,
        adapterCapabilities: adapter.metadata.capabilities as any[],
      });

      // Should have degraded mode warnings
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);

      // Should not have GPU stall detections
      const gpuDetections = result.detections.filter(
        (d) => d.type === 'gpu_stall',
      );
      expect(gpuDetections.length).toBe(0);
    });

    it('should produce valid summary from Swift SDK trace', async () => {
      const swiftTrace = createValidSwiftTrace();
      const traceFile = join(testDir, 'e2e-summary.json');
      await writeFile(traceFile, JSON.stringify(swiftTrace));

      const adapter = new WebKitNativeAdapter();
      await adapter.connect({ traceFile });
      const snapshot = await adapter.collectTrace({
        name: 'e2e-summary-test',
        fpsTarget: 60,
      });
      await adapter.disconnect();

      const traceData = convertSnapshotToTraceData(snapshot);

      const result = await analyzerService.analyze(traceData, {
        name: 'e2e-summary-analysis',
        fpsTarget: 60,
      });

      // Verify summary structure
      expect(result.summary.id).toBeDefined();
      expect(result.summary.name).toBe('e2e-summary-analysis');
      expect(result.summary.frames).toBeDefined();
      expect(result.summary.frames.total).toBeGreaterThan(0);
      expect(result.summary.frames.frame_budget_ms).toBeCloseTo(16.67, 1);
      expect(result.summary.phase_breakdown).toBeDefined();
      expect(result.summary.hotspots).toBeDefined();
    });
  });

  describe('Adapter Selection', () => {
    it('should select webkit-native adapter for Safari', () => {
      const adapter = adapterRegistry.selectAdapter({
        browserPath: '/Applications/Safari.app/Contents/MacOS/Safari',
      });

      expect(adapter.metadata.type).toBe('webkit-native');
    });

    it('should select chromium-cdp adapter for Chrome', () => {
      const adapter = adapterRegistry.selectAdapter({
        browserPath:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      });

      expect(adapter.metadata.type).toBe('chromium-cdp');
    });

    it('should select chromium-cdp adapter for Arc staging builds', () => {
      const adapter = adapterRegistry.selectAdapter({
        browserPath: '/Applications/Arc.app/Contents/MacOS/Arc',
      });

      expect(adapter.metadata.type).toBe('chromium-cdp');
    });

    it('should default to chromium-cdp when no browser path provided', () => {
      const adapter = adapterRegistry.selectAdapter({});

      expect(adapter.metadata.type).toBe('chromium-cdp');
    });

    it('should allow explicit adapter selection', () => {
      const adapter = adapterRegistry.selectAdapter({
        adapterType: 'webkit-native',
      });

      expect(adapter.metadata.type).toBe('webkit-native');
    });
  });
});

// Helper functions to create test traces

function createValidSwiftTrace(): NativeTraceFormat {
  const frames = [];
  const frameBudgetUs = 16667; // ~60fps in microseconds

  for (let i = 0; i < 60; i++) {
    const startTimestamp = i * frameBudgetUs;
    const durationMs = 14 + Math.random() * 4; // 14-18ms
    frames.push({
      frameId: i,
      startTimestamp,
      endTimestamp: startTimestamp + Math.round(durationMs * 1000),
      durationMs,
      dropped: durationMs > 16.67,
    });
  }

  return {
    version: '1.0',
    traceId: `test-trace-${Date.now()}`,
    name: 'test-trace',
    durationMs: 1000,
    frames,
    longTasks: [],
    domSignals: [],
    metadata: {
      osVersion: '17.0',
      deviceModel: 'iPhone15,2',
      timestamp: new Date().toISOString(),
      fpsTarget: 60,
      sdkVersion: '1.0.0',
    },
  };
}

function createSwiftTraceWithDroppedFrames(): NativeTraceFormat {
  const trace = createValidSwiftTrace();

  // Add some dropped frames (>16.67ms)
  trace.frames[10] = {
    ...trace.frames[10]!,
    durationMs: 35,
    dropped: true,
  };
  trace.frames[20] = {
    ...trace.frames[20]!,
    durationMs: 50,
    dropped: true,
  };
  trace.frames[30] = {
    ...trace.frames[30]!,
    durationMs: 25,
    dropped: true,
  };

  return trace;
}

function createSwiftTraceWithLongTasks(): NativeTraceFormat {
  const trace = createValidSwiftTrace();

  trace.longTasks = [
    {
      startTimestamp: 100000,
      durationMs: 75,
      name: 'heavyComputation',
      source: 'native',
      functionName: 'processData',
      file: 'DataProcessor.swift',
      line: 42,
    },
    {
      startTimestamp: 500000,
      durationMs: 120,
      name: 'networkCallback',
      source: 'webview',
      functionName: 'handleResponse',
      file: 'api.js',
      line: 156,
    },
    {
      startTimestamp: 800000,
      durationMs: 60,
      name: 'renderUpdate',
      source: 'native',
      functionName: 'updateUI',
    },
  ];

  return trace;
}

function convertSnapshotToTraceData(snapshot: TraceSnapshot): TraceData {
  // Convert TraceSnapshot to the trace format expected by analyzer
  const traceEvents: TraceEvent[] = [];

  // Convert frame timings to trace events
  for (const frame of snapshot.frameTimings) {
    traceEvents.push({
      pid: 1,
      tid: 1,
      ts: frame.startTime,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: {},
    });

    traceEvents.push({
      pid: 1,
      tid: 1,
      ts: frame.endTime,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'DrawFrame',
      args: {},
    });
  }

  // Convert long tasks to trace events
  for (const task of snapshot.longTasks) {
    traceEvents.push({
      pid: 1,
      tid: 1,
      ts: task.startTime,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'FunctionCall',
      dur: task.durationMs * 1000,
      args: {
        data: {
          functionName: task.functionName ?? 'unknown',
          url: task.file ?? '',
          lineNumber: task.line ?? 0,
          columnNumber: task.column ?? 0,
        },
      },
    });
  }

  const metadata: TraceMetadata = {
    browser_version: snapshot.metadata.browserVersion ?? 'WebKit Native',
    user_agent: snapshot.metadata.userAgent ?? 'WebKit',
    viewport: snapshot.metadata.viewport ?? { width: 390, height: 844 },
    device_pixel_ratio: snapshot.metadata.devicePixelRatio ?? 3,
    timestamp: snapshot.metadata.timestamp,
    scenario: snapshot.metadata.scenario ?? 'unknown',
    fps_target: snapshot.metadata.fpsTarget,
  };

  return {
    traceEvents,
    metadata,
  };
}
