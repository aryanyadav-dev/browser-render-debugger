/**
 * Synthetic trace fixture for long task patterns
 * Simulates JavaScript tasks >50ms that block the main thread
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
  scenario: 'long-task-test',
  fps_target: 60,
};

/**
 * Creates a synthetic trace with long task patterns
 * Simulates JavaScript tasks that exceed 50ms threshold
 */
export function createLongTaskTrace(
  options: {
    taskCount?: number;
    avgTaskDurationMs?: number;
    functionName?: string;
    fileName?: string;
  } = {},
): TraceData {
  const {
    taskCount = 4,
    avgTaskDurationMs = 80,
    functionName = 'heavyComputation',
    fileName = 'app.js',
  } = options;

  const traceEvents = [];
  const pid = 1;
  const tid = 1;
  let ts = 0;

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

  // Generate frames with long tasks
  for (let i = 0; i < taskCount; i++) {
    const frameStart = ts;
    // Vary task duration slightly around the average
    const taskDurationMs = avgTaskDurationMs + (i % 2 === 0 ? 10 : -5);
    const taskDurationUs = taskDurationMs * 1000;

    // BeginFrame
    traceEvents.push({
      pid,
      tid,
      ts: frameStart,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: { frameId: i },
      s: 'g',
    });

    // Long JavaScript task (FunctionCall) - use 'X' complete event with dur
    traceEvents.push({
      pid,
      tid,
      ts: frameStart + 1000,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'FunctionCall',
      dur: taskDurationUs,
      args: {
        data: {
          functionName: functionName,
          scriptName: fileName,
          url: `http://localhost:3000/${fileName}`,
          lineNumber: 150 + i * 10,
          columnNumber: 5,
          stackTrace: [
            {
              functionName: functionName,
              url: `http://localhost:3000/${fileName}`,
              lineNumber: 150 + i * 10,
              columnNumber: 5,
            },
            {
              functionName: 'processData',
              url: `http://localhost:3000/${fileName}`,
              lineNumber: 200,
              columnNumber: 10,
            },
            {
              functionName: 'handleEvent',
              url: `http://localhost:3000/${fileName}`,
              lineNumber: 50,
              columnNumber: 3,
            },
          ],
        },
      },
    });

    // The frame will be dropped because task exceeds budget
    // Add a DrawFrame that's delayed
    traceEvents.push({
      pid,
      tid,
      ts: frameStart + 1000 + taskDurationUs + 500,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'DrawFrame',
      args: { frameId: i },
      s: 'g',
    });

    // Move to next frame (with dropped frame gap)
    ts = frameStart + taskDurationUs + 5000;
  }

  // Add some additional timer-based long tasks
  for (let i = 0; i < 2; i++) {
    const frameStart = ts;
    const taskDurationUs = 60000; // 60ms

    // BeginFrame
    traceEvents.push({
      pid,
      tid,
      ts: frameStart,
      ph: 'I',
      cat: 'devtools.timeline',
      name: 'BeginFrame',
      args: { frameId: taskCount + i },
      s: 'g',
    });

    // Timer-fired long task - use 'X' complete event with dur
    traceEvents.push({
      pid,
      tid,
      ts: frameStart + 1000,
      ph: 'X',
      cat: 'devtools.timeline',
      name: 'TimerFire',
      dur: taskDurationUs,
      args: {
        data: {
          functionName: 'timerCallback',
          scriptName: 'timer.js',
          url: 'http://localhost:3000/timer.js',
          lineNumber: 25,
          columnNumber: 1,
          stackTrace: [
            {
              functionName: 'timerCallback',
              url: 'http://localhost:3000/timer.js',
              lineNumber: 25,
              columnNumber: 1,
            },
          ],
        },
      },
    });

    ts = frameStart + taskDurationUs + 5000;
  }

  // Final frame marker
  traceEvents.push({
    pid,
    tid,
    ts,
    ph: 'I',
    cat: 'devtools.timeline',
    name: 'BeginFrame',
    args: { frameId: taskCount + 2 },
    s: 'g',
  });

  return {
    traceEvents,
    metadata: baseMetadata,
  };
}

/**
 * Pre-built long task trace for quick testing
 */
export const longTaskTrace: TraceData = createLongTaskTrace({
  taskCount: 4,
  avgTaskDurationMs: 80,
  functionName: 'heavyComputation',
  fileName: 'app.js',
});
