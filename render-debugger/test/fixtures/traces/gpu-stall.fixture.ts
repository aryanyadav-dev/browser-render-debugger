/**
 * Synthetic trace fixture for GPU stall patterns
 * Simulates GPU sync events, texture uploads, and raster stalls
 */

import type {
  TraceData,
  TraceMetadata,
} from '../../../src/shared/types/trace.types.js';

const baseMetadata: TraceMetadata = {
  browser_version: '120.0.0.0',
  user_agent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
  viewport: { width: 1920, height: 1080 },
  device_pixel_ratio: 2,
  timestamp: new Date().toISOString(),
  scenario: 'gpu-stall-test',
  fps_target: 60,
};

/**
 * Creates a synthetic trace with GPU stall patterns
 * Simulates main thread blocking on GPU operations
 */
export function createGPUStallTrace(
  options: {
    syncStalls?: number;
    textureUploads?: number;
    rasterStalls?: number;
    stallDurationMs?: number;
  } = {},
): TraceData {
  const {
    syncStalls = 3,
    textureUploads = 2,
    rasterStalls = 2,
    stallDurationMs = 10,
  } = options;

  const traceEvents = [];
  const pid = 1;
  const mainTid = 1;
  const gpuTid = 2;
  let ts = 0;
  const frameBudgetUs = 16667;

  // Add thread name metadata
  traceEvents.push({
    pid,
    tid: mainTid,
    ts: 0,
    ph: 'M',
    cat: '__metadata',
    name: 'thread_name',
    args: { name: 'CrRendererMain' },
  });

  traceEvents.push({
    pid,
    tid: gpuTid,
    ts: 0,
    ph: 'M',
    cat: '__metadata',
    name: 'thread_name',
    args: { name: 'GPU' },
  });

  const totalFrames = syncStalls + textureUploads + rasterStalls;
  const stallDurUs = stallDurationMs * 1000;

  // Generate GPU sync stalls
  for (let i = 0; i < syncStalls; i++) {
    const frameStart = ts;

    // BeginFrame
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: { frameId: i },
      s: 'g',
    });

    // GPU sync stall - main thread waiting (use 'X' complete event with dur)
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart + 2000,
      ph: 'X',
      cat: 'gpu',
      name: 'GPUTask',
      dur: stallDurUs,
      args: {
        data: {
          layerId: 1,
          elementId: 'heavy-svg-element',
        },
      },
    });

    // Wait event on main thread during GPU work
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart + 3000,
      ph: 'X',
      cat: 'gpu',
      name: 'WaitForSwap',
      dur: stallDurUs / 2,
      args: {},
    });

    ts = frameStart + frameBudgetUs;
  }

  // Generate texture upload stalls
  for (let i = 0; i < textureUploads; i++) {
    const frameStart = ts;
    const frameIdx = syncStalls + i;

    // BeginFrame
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: { frameId: frameIdx },
      s: 'g',
    });

    // Texture upload stall
    traceEvents.push({
      pid,
      tid: gpuTid,
      ts: frameStart + 2000,
      ph: 'X',
      cat: 'gpu',
      name: 'UploadTexture',
      dur: stallDurUs,
      args: {
        textureId: i + 1,
        data: {
          url: `image-${i}.png`,
          layerId: 2,
        },
      },
    });

    // Main thread sync wait
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart + 2500,
      ph: 'X',
      cat: 'gpu',
      name: 'Gpu::SwapBuffers',
      dur: stallDurUs,
      args: {},
    });

    ts = frameStart + frameBudgetUs;
  }

  // Generate raster stalls
  for (let i = 0; i < rasterStalls; i++) {
    const frameStart = ts;
    const frameIdx = syncStalls + textureUploads + i;

    // BeginFrame
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: { frameId: frameIdx },
      s: 'g',
    });

    // Raster task stall
    traceEvents.push({
      pid,
      tid: gpuTid,
      ts: frameStart + 2000,
      ph: 'X',
      cat: 'gpu',
      name: 'RasterTask',
      dur: stallDurUs,
      args: {
        tileId: `tile-${i}`,
        data: {
          layerId: 3,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          compositingReasons: ['transform', 'will-change'],
        },
      },
    });

    // Main thread waiting
    traceEvents.push({
      pid,
      tid: mainTid,
      ts: frameStart + 2200,
      ph: 'X',
      cat: 'gpu',
      name: 'WaitForSwap',
      dur: stallDurUs,
      args: {},
    });

    ts = frameStart + frameBudgetUs;
  }

  // Final frame marker
  traceEvents.push({
    pid,
    tid: mainTid,
    ts,
    ph: 'I',
    cat: 'devtools.timeline',
    name: 'BeginFrame',
    args: { frameId: totalFrames },
    s: 'g',
  });

  return {
    traceEvents,
    metadata: baseMetadata,
  };
}

/**
 * Pre-built GPU stall trace for quick testing
 */
export const gpuStallTrace: TraceData = createGPUStallTrace({
  syncStalls: 3,
  textureUploads: 2,
  rasterStalls: 2,
  stallDurationMs: 10,
});
