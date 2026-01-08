/**
 * Long Task Correlator
 * Detects JavaScript tasks >50ms and correlates them with frame drops
 *
 * Requirements: 15.20
 */

import { Injectable } from '@nestjs/common';
import type {
  TraceData,
  TraceEvent,
  Detection,
  LongTaskDetection,
  StackFrame,
} from '../../shared/types/index.js';
import type { IDetector, DetectionContext } from '../interfaces/index.js';
import { AdapterCapability } from '../../adapters/interfaces/index.js';
import { ScoringService, type ScoringInput } from '../scoring/index.js';

// Default long task threshold in milliseconds
const LONG_TASK_THRESHOLD_MS = 50;

interface TaskEvent {
  ts: number;
  dur: number;
  functionName: string;
  file: string;
  line: number;
  column: number;
  callStack: StackFrame[];
}

interface TaskPattern {
  functionName: string;
  file: string;
  line: number;
  column: number;
  events: TaskEvent[];
  totalCpuMs: number;
  correlatedFrameDrops: number;
  callStack: StackFrame[];
}

// Event names that indicate JavaScript execution
const JS_EXECUTION_EVENTS = new Set([
  'FunctionCall',
  'EvaluateScript',
  'v8.compile',
  'v8.run',
  'V8.Execute',
  'RunMicrotasks',
  'TimerFire',
  'EventDispatch',
  'XHRReadyStateChange',
  'RequestAnimationFrame',
  'FireAnimationFrame',
  'ParseHTML',
  'ParseAuthorStyleSheet',
]);

@Injectable()
export class LongTaskDetector implements IDetector {
  readonly name = 'LongTaskDetector';
  readonly priority = 3;
  /** Long task detection requires long task capability */
  readonly requiredCapabilities = [AdapterCapability.LONG_TASKS];

  constructor(private readonly scoringService: ScoringService) {}

  /**
   * Detect long tasks in trace data
   */
  detect(trace: TraceData, context: DetectionContext): Promise<Detection[]> {
    const longTasks = this.extractLongTasks(trace);
    const frameDrops = this.extractFrameDrops(trace, context);
    const taskPatterns = this.correlateWithFrameDrops(longTasks, frameDrops);

    return Promise.resolve(
      taskPatterns.map((pattern) => this.createDetection(pattern, context)),
    );
  }

  /**
   * Extract long tasks from trace
   */
  private extractLongTasks(trace: TraceData): TaskEvent[] {
    const tasks: TaskEvent[] = [];
    const thresholdUs = LONG_TASK_THRESHOLD_MS * 1000;

    for (const event of trace.traceEvents) {
      if (!this.isJSExecutionEvent(event)) continue;
      if ((event.dur ?? 0) < thresholdUs) continue;

      const { functionName, file, line, column, callStack } =
        this.extractCallInfo(event);

      tasks.push({
        ts: event.ts,
        dur: event.dur ?? 0,
        functionName,
        file,
        line,
        column,
        callStack,
      });
    }

    return tasks.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Check if event is a JavaScript execution event
   */
  private isJSExecutionEvent(event: TraceEvent): boolean {
    if (JS_EXECUTION_EVENTS.has(event.name)) return true;

    // Check category
    if (event.cat?.includes('devtools.timeline')) {
      if (
        event.name.includes('Function') ||
        event.name.includes('Script') ||
        event.name.includes('Timer') ||
        event.name.includes('Event')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract call information from event
   */
  private extractCallInfo(event: TraceEvent): {
    functionName: string;
    file: string;
    line: number;
    column: number;
    callStack: StackFrame[];
  } {
    const args = event.args;
    const callStack: StackFrame[] = [];

    let functionName = 'anonymous';
    let file = 'unknown';
    let line = 0;
    let column = 0;

    if (args?.data && typeof args.data === 'object') {
      const data = args.data as Record<string, unknown>;

      if (typeof data.functionName === 'string') {
        functionName = data.functionName;
      }
      if (typeof data.scriptName === 'string') {
        file = data.scriptName;
      } else if (typeof data.url === 'string') {
        file = data.url;
      }
      if (typeof data.lineNumber === 'number') {
        line = data.lineNumber;
      }
      if (typeof data.columnNumber === 'number') {
        column = data.columnNumber;
      }

      // Extract stack trace
      if (Array.isArray(data.stackTrace)) {
        for (const frame of data.stackTrace) {
          if (typeof frame === 'object' && frame !== null) {
            const f = frame as Record<string, unknown>;
            callStack.push({
              functionName:
                typeof f.functionName === 'string'
                  ? f.functionName
                  : 'anonymous',
              file: typeof f.url === 'string' ? f.url : 'unknown',
              line: typeof f.lineNumber === 'number' ? f.lineNumber : 0,
              column: typeof f.columnNumber === 'number' ? f.columnNumber : 0,
              isSourceMapped: false,
            });
          }
        }
      }
    }

    // Try to get info from beginData
    if (args?.beginData && typeof args.beginData === 'object') {
      const beginData = args.beginData as Record<string, unknown>;

      if (Array.isArray(beginData.stackTrace)) {
        for (const frame of beginData.stackTrace) {
          if (typeof frame === 'object' && frame !== null) {
            const f = frame as Record<string, unknown>;
            const stackFrame: StackFrame = {
              functionName:
                typeof f.functionName === 'string'
                  ? f.functionName
                  : 'anonymous',
              file: typeof f.url === 'string' ? f.url : 'unknown',
              line: typeof f.lineNumber === 'number' ? f.lineNumber : 0,
              column: typeof f.columnNumber === 'number' ? f.columnNumber : 0,
              isSourceMapped: false,
            };
            callStack.push(stackFrame);

            // Use first frame for main info if not set
            if (
              functionName === 'anonymous' &&
              stackFrame.functionName !== 'anonymous'
            ) {
              functionName = stackFrame.functionName;
              file = stackFrame.file;
              line = stackFrame.line;
              column = stackFrame.column;
            }
          }
        }
      }
    }

    // Fallback to event name
    if (functionName === 'anonymous') {
      functionName = event.name;
    }

    return { functionName, file, line, column, callStack };
  }

  /**
   * Extract frame drops from trace
   */
  private extractFrameDrops(
    trace: TraceData,
    context: DetectionContext,
  ): Array<{ ts: number; duration: number }> {
    const frameDrops: Array<{ ts: number; duration: number }> = [];
    const frameEvents = trace.traceEvents.filter(
      (e) =>
        e.name === 'BeginFrame' ||
        e.name === 'DrawFrame' ||
        e.name === 'BeginMainThreadFrame',
    );

    const budgetUs = context.frameBudgetMs * 1000;

    for (let i = 1; i < frameEvents.length; i++) {
      const current = frameEvents[i]!;
      const prev = frameEvents[i - 1]!;
      const frameDuration = current.ts - prev.ts;

      if (frameDuration > budgetUs) {
        frameDrops.push({
          ts: prev.ts,
          duration: frameDuration,
        });
      }
    }

    return frameDrops;
  }

  /**
   * Correlate long tasks with frame drops
   */
  private correlateWithFrameDrops(
    longTasks: TaskEvent[],
    frameDrops: Array<{ ts: number; duration: number }>,
  ): TaskPattern[] {
    const patterns = new Map<string, TaskPattern>();

    for (const task of longTasks) {
      const taskEnd = task.ts + task.dur;

      // Count frame drops that overlap with this task
      let correlatedDrops = 0;
      for (const drop of frameDrops) {
        const dropEnd = drop.ts + drop.duration;
        // Check for overlap
        if (task.ts < dropEnd && taskEnd > drop.ts) {
          correlatedDrops++;
        }
      }

      // Create pattern key based on function and location
      const key = `${task.functionName}:${task.file}:${task.line}`;
      const existing = patterns.get(key);

      if (existing) {
        existing.events.push(task);
        existing.totalCpuMs += task.dur / 1000;
        existing.correlatedFrameDrops += correlatedDrops;
        // Keep the longest call stack
        if (task.callStack.length > existing.callStack.length) {
          existing.callStack = task.callStack;
        }
      } else {
        patterns.set(key, {
          functionName: task.functionName,
          file: task.file,
          line: task.line,
          column: task.column,
          events: [task],
          totalCpuMs: task.dur / 1000,
          correlatedFrameDrops: correlatedDrops,
          callStack: task.callStack,
        });
      }
    }

    return Array.from(patterns.values());
  }

  /**
   * Create a detection from a task pattern
   */
  private createDetection(
    pattern: TaskPattern,
    context: DetectionContext,
  ): LongTaskDetection {
    // Calculate trace duration in milliseconds
    const traceDurationMs =
      (context.traceEndTime - context.traceStartTime) / 1000;
    const avgCpuMs = pattern.totalCpuMs / pattern.events.length;

    // Use ScoringService for consistent scoring
    const scoringInput: ScoringInput = {
      detectionType: 'long_task',
      durationMs: pattern.totalCpuMs,
      occurrences: pattern.events.length,
      frameBudgetMs: context.frameBudgetMs,
      traceDurationMs: traceDurationMs > 0 ? traceDurationMs : 1000,
      correlatedFrameDrops: pattern.correlatedFrameDrops,
    };

    const scoringResult = this.scoringService.calculateScore(scoringInput);

    return {
      type: 'long_task',
      severity: scoringResult.severity,
      description: `Long task "${pattern.functionName}" averaging ${avgCpuMs.toFixed(1)}ms, correlated with ${pattern.correlatedFrameDrops} frame drops`,
      location: {
        file: pattern.file,
        line: pattern.line,
        column: pattern.column,
      },
      metrics: {
        durationMs: pattern.totalCpuMs,
        occurrences: pattern.events.length,
        impactScore: scoringResult.impactScore,
        confidence: scoringResult.confidence,
        estimatedSpeedupPct: scoringResult.estimatedSpeedupPct,
        speedupExplanation: scoringResult.speedupExplanation,
        frameBudgetImpactPct: scoringResult.frameBudgetImpactPct,
        riskAssessment: scoringResult.riskAssessment,
      },
      evidence: [],
      functionName: pattern.functionName,
      file: pattern.file,
      line: pattern.line,
      column: pattern.column,
      cpuMs: pattern.totalCpuMs,
      occurrences: pattern.events.length,
      correlatedFrameDrops: pattern.correlatedFrameDrops,
      callStack: pattern.callStack,
    };
  }
}
