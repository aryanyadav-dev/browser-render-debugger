/**
 * Synthetic trace fixture for layout thrashing patterns
 * Simulates repeated read-after-write DOM access patterns that cause forced reflows
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
  scenario: 'layout-thrash-test',
  fps_target: 60,
};

/**
 * Creates a synthetic trace with layout thrashing patterns
 * Simulates the pattern: read offsetWidth -> write style.width -> read offsetWidth (forced reflow)
 */
export function createLayoutThrashTrace(
  options: {
    occurrences?: number;
    reflowCostMs?: number;
    affectedNodes?: number;
  } = {},
): TraceData {
  const { occurrences = 5, reflowCostMs = 15, affectedNodes = 100 } = options;

  const traceEvents = [];
  const pid = 1;
  const tid = 1;
  let ts = 0;
  const frameBudgetUs = 16667; // ~16.67ms for 60fps

  // Add thread name metadata
  traceEvents.push({
    pid,
    tid,
    ts: 0,
    ph: 'M',
    cat: '__metadata',
    name: 'thread_name',
    args: { name: 'CrRendererMain' },
  });

  // Generate multiple frames with layout thrashing
  for (let frame = 0; frame < occurrences; frame++) {
    const frameStart = frame * frameBudgetUs;

    // BeginFrame event
    traceEvents.push({
      pid,
      tid,
      ts: frameStart,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: { frameId: frame },
      s: 'g',
    });

    // Simulate layout thrashing pattern within the frame
    // Use 'X' (complete) events with dur property for proper detection
    const layoutDurUs = (reflowCostMs * 1000) / 3;

    // First layout (read triggers)
    const layout1Start = frameStart + 1000;
    traceEvents.push({
      pid,
      tid,
      ts: layout1Start,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'Layout',
      dur: layoutDurUs,
      args: {
        beginData: {
          stackTrace: [
            { functionName: 'readOffsetWidth', url: 'app.js', lineNumber: 42 },
            { functionName: 'updateLayout', url: 'app.js', lineNumber: 100 },
          ],
        },
        data: {
          elementCount: affectedNodes,
          selectorStats: '.card-container',
        },
      },
    });

    // Style write (triggers invalidation)
    const styleStart = layout1Start + layoutDurUs + 100;
    traceEvents.push({
      pid,
      tid,
      ts: styleStart,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'UpdateLayoutTree',
      dur: 500,
      args: {
        data: {
          elementCount: affectedNodes,
        },
      },
    });

    // Second layout (forced reflow due to read after write) - rapid succession
    const layout2Start = styleStart + 600; // Close to previous event
    traceEvents.push({
      pid,
      tid,
      ts: layout2Start,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'Layout',
      dur: layoutDurUs,
      args: {
        beginData: {
          stackTrace: [
            { functionName: 'readOffsetWidth', url: 'app.js', lineNumber: 45 },
            { functionName: 'updateLayout', url: 'app.js', lineNumber: 100 },
          ],
        },
        data: {
          elementCount: affectedNodes,
          selectorStats: '.card-container',
        },
      },
    });

    // Third layout (another forced reflow) - rapid succession
    const layout3Start = layout2Start + layoutDurUs + 100; // Very close
    traceEvents.push({
      pid,
      tid,
      ts: layout3Start,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'Layout',
      dur: layoutDurUs,
      args: {
        beginData: {
          stackTrace: [
            { functionName: 'readClientHeight', url: 'app.js', lineNumber: 48 },
            { functionName: 'updateLayout', url: 'app.js', lineNumber: 100 },
          ],
        },
        data: {
          elementCount: affectedNodes,
          selectorStats: '.card-container',
        },
      },
    });

    ts = layout3Start + layoutDurUs + 1000;
  }

  // Final frame marker
  traceEvents.push({
    pid,
    tid,
    ts,
    ph: 'I',
    cat: 'devtools.timeline',
    name: 'BeginFrame',
    args: { frameId: occurrences },
    s: 'g',
  });

  return {
    traceEvents,
    metadata: baseMetadata,
  };
}

/**
 * Pre-built layout thrash trace for quick testing
 */
export const layoutThrashTrace: TraceData = createLayoutThrashTrace({
  occurrences: 5,
  reflowCostMs: 15,
  affectedNodes: 100,
});
