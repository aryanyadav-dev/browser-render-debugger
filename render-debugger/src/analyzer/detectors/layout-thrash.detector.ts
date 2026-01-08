/**
 * Layout Thrash Detector
 * Detects read-after-write patterns in trace events that cause forced reflows
 *
 * Requirements: 15.20
 */

import { Injectable } from '@nestjs/common';
import type {
  TraceData,
  TraceEvent,
  Detection,
  LayoutThrashDetection,
  ReadWritePattern,
  DOMPropertyAccess,
} from '../../shared/types/index.js';
import type { IDetector, DetectionContext } from '../interfaces/index.js';
import { AdapterCapability } from '../../adapters/interfaces/index.js';
import { ScoringService, type ScoringInput } from '../scoring/index.js';

// DOM properties that trigger layout when read
const LAYOUT_TRIGGERING_READS = new Set([
  'offsetTop',
  'offsetLeft',
  'offsetWidth',
  'offsetHeight',
  'offsetParent',
  'clientTop',
  'clientLeft',
  'clientWidth',
  'clientHeight',
  'scrollTop',
  'scrollLeft',
  'scrollWidth',
  'scrollHeight',
  'getComputedStyle',
  'getBoundingClientRect',
  'getClientRects',
  'innerText',
  'focus',
]);

// DOM properties that trigger layout when written
const LAYOUT_TRIGGERING_WRITES = new Set([
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'padding',
  'border',
  'font',
  'display',
  'position',
  'float',
  'clear',
  'overflow',
  'transform',
  'className',
  'classList',
  'innerHTML',
  'textContent',
  'style',
]);

interface LayoutEvent {
  ts: number;
  dur: number;
  selector?: string;
  nodeCount?: number;
  stackTrace?: string[];
}

interface ThrashingPattern {
  selector: string;
  events: LayoutEvent[];
  totalCostMs: number;
  affectedNodes: number;
  readWritePatterns: ReadWritePattern[];
}

@Injectable()
export class LayoutThrashDetector implements IDetector {
  readonly name = 'LayoutThrashDetector';
  readonly priority = 1;
  /** Layout thrash detection works best with DOM signals but can work with basic frame timing */
  readonly requiredCapabilities = [AdapterCapability.FRAME_TIMING];

  constructor(private readonly scoringService: ScoringService) {}

  /**
   * Detect layout thrashing patterns in trace data
   */
  detect(trace: TraceData, context: DetectionContext): Promise<Detection[]> {
    const layoutEvents = this.extractLayoutEvents(trace);
    const thrashingPatterns = this.findThrashingPatterns(
      layoutEvents,
      trace,
      context,
    );

    return Promise.resolve(
      thrashingPatterns.map((pattern) =>
        this.createDetection(pattern, context),
      ),
    );
  }

  /**
   * Extract layout-related events from trace
   */
  private extractLayoutEvents(trace: TraceData): LayoutEvent[] {
    const events: LayoutEvent[] = [];

    for (const event of trace.traceEvents) {
      if (this.isLayoutEvent(event)) {
        events.push({
          ts: event.ts,
          dur: event.dur ?? 0,
          selector: this.extractSelector(event),
          nodeCount: this.extractNodeCount(event),
          stackTrace: this.extractStackTrace(event),
        });
      }
    }

    return events.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Check if event is a layout-related event
   */
  private isLayoutEvent(event: TraceEvent): boolean {
    return (
      event.name === 'Layout' ||
      event.name === 'UpdateLayoutTree' ||
      event.name === 'RecalculateStyles' ||
      event.name === 'InvalidateLayout' ||
      event.name === 'ScheduleStyleRecalculation'
    );
  }

  /**
   * Extract CSS selector from event args
   */
  private extractSelector(event: TraceEvent): string {
    const args = event.args;
    if (!args) return 'unknown';

    // Try different arg structures
    if (args.data && typeof args.data === 'object') {
      const data = args.data as Record<string, unknown>;
      if (typeof data.selectorStats === 'string') return data.selectorStats;
      if (typeof data.selector === 'string') return data.selector;
      if (typeof data.nodeName === 'string') return data.nodeName;
    }

    if (args.beginData && typeof args.beginData === 'object') {
      const beginData = args.beginData as Record<string, unknown>;
      if (typeof beginData.stackTrace === 'object' && beginData.stackTrace) {
        const stack = beginData.stackTrace as Array<{
          functionName?: string;
          url?: string;
        }>;
        if (stack[0]?.functionName) return stack[0].functionName;
      }
    }

    return 'unknown';
  }

  /**
   * Extract affected node count from event
   */
  private extractNodeCount(event: TraceEvent): number {
    const args = event.args;
    if (!args) return 1;

    if (args.data && typeof args.data === 'object') {
      const data = args.data as Record<string, unknown>;
      if (typeof data.elementCount === 'number') return data.elementCount;
      if (typeof data.nodeCount === 'number') return data.nodeCount;
    }

    if (typeof args.elementCount === 'number') return args.elementCount;

    return 1;
  }

  /**
   * Extract stack trace from event
   */
  private extractStackTrace(event: TraceEvent): string[] {
    const args = event.args;
    if (!args) return [];

    type StackFrameData = {
      functionName?: string;
      url?: string;
      lineNumber?: number;
    };

    const extractFromStack = (stack: unknown): StackFrameData[] => {
      if (Array.isArray(stack)) {
        return stack.filter(
          (item): item is StackFrameData =>
            typeof item === 'object' && item !== null,
        );
      }
      return [];
    };

    if (args.beginData && typeof args.beginData === 'object') {
      const beginData = args.beginData as Record<string, unknown>;
      const stack = extractFromStack(beginData.stackTrace);
      return stack
        .map((frame) => {
          if (frame.functionName && frame.url) {
            return `${frame.functionName} (${frame.url}:${frame.lineNumber ?? 0})`;
          }
          return frame.functionName ?? 'anonymous';
        })
        .filter(Boolean);
    }

    if (args.data && typeof args.data === 'object') {
      const data = args.data as Record<string, unknown>;
      const stack = extractFromStack(data.stackTrace);
      return stack
        .map((frame) => frame.functionName ?? 'anonymous')
        .filter(Boolean);
    }

    return [];
  }

  /**
   * Find thrashing patterns (rapid read-write-read sequences)
   */
  private findThrashingPatterns(
    layoutEvents: LayoutEvent[],
    trace: TraceData,
    context: DetectionContext,
  ): ThrashingPattern[] {
    const patterns = new Map<string, ThrashingPattern>();

    // Group events by frame
    const frameGroups = this.groupEventsByFrame(layoutEvents, trace, context);

    // Analyze each frame for thrashing
    for (const [frameId, events] of frameGroups) {
      if (events.length < 2) continue;

      // Check for rapid successive layouts (thrashing indicator)
      const thrashingEvents = this.detectRapidLayouts(events, context);

      for (const event of thrashingEvents) {
        const key = event.selector ?? 'unknown';
        const existing = patterns.get(key);

        if (existing) {
          existing.events.push(event);
          existing.totalCostMs += event.dur / 1000;
          existing.affectedNodes = Math.max(
            existing.affectedNodes,
            event.nodeCount ?? 1,
          );
          existing.readWritePatterns.push(
            this.createReadWritePattern(frameId, event),
          );
        } else {
          patterns.set(key, {
            selector: key,
            events: [event],
            totalCostMs: event.dur / 1000,
            affectedNodes: event.nodeCount ?? 1,
            readWritePatterns: [this.createReadWritePattern(frameId, event)],
          });
        }
      }
    }

    // Filter patterns that meet minimum threshold
    return Array.from(patterns.values()).filter(
      (p) => p.events.length >= 2 && p.totalCostMs >= 1,
    );
  }

  /**
   * Group layout events by frame
   */
  private groupEventsByFrame(
    layoutEvents: LayoutEvent[],
    trace: TraceData,
    context: DetectionContext,
  ): Map<number, LayoutEvent[]> {
    const frameGroups = new Map<number, LayoutEvent[]>();

    // Find frame boundaries
    const frameEvents = trace.traceEvents.filter(
      (e) => e.name === 'BeginFrame' || e.name === 'BeginMainThreadFrame',
    );

    if (frameEvents.length === 0) {
      // No frame events, group by time windows
      const windowMs = context.frameBudgetMs * 1000; // Convert to microseconds
      for (const event of layoutEvents) {
        const frameId = Math.floor(
          (event.ts - context.traceStartTime) / windowMs,
        );
        const existing = frameGroups.get(frameId) ?? [];
        existing.push(event);
        frameGroups.set(frameId, existing);
      }
    } else {
      // Group by actual frame boundaries
      for (let i = 0; i < frameEvents.length; i++) {
        const frameStart = frameEvents[i]!.ts;
        const frameEnd = frameEvents[i + 1]?.ts ?? Infinity;

        const eventsInFrame = layoutEvents.filter(
          (e) => e.ts >= frameStart && e.ts < frameEnd,
        );

        if (eventsInFrame.length > 0) {
          frameGroups.set(i, eventsInFrame);
        }
      }
    }

    return frameGroups;
  }

  /**
   * Detect rapid successive layouts within a frame
   */
  private detectRapidLayouts(
    events: LayoutEvent[],
    context: DetectionContext,
  ): LayoutEvent[] {
    const thrashingEvents: LayoutEvent[] = [];
    const thresholdUs = (context.frameBudgetMs * 1000) / 4; // Quarter of frame budget

    for (let i = 1; i < events.length; i++) {
      const current = events[i]!;
      const prev = events[i - 1]!;

      // If layouts happen in rapid succession, it's likely thrashing
      if (current.ts - (prev.ts + prev.dur) < thresholdUs) {
        if (!thrashingEvents.includes(prev)) {
          thrashingEvents.push(prev);
        }
        thrashingEvents.push(current);
      }
    }

    return thrashingEvents;
  }

  /**
   * Create a read-write pattern from a layout event
   */
  private createReadWritePattern(
    frameId: number,
    event: LayoutEvent,
  ): ReadWritePattern {
    // Infer read/write pattern from stack trace
    const reads: DOMPropertyAccess[] = [];
    const writes: DOMPropertyAccess[] = [];

    for (const frame of event.stackTrace ?? []) {
      for (const prop of LAYOUT_TRIGGERING_READS) {
        if (frame.includes(prop)) {
          reads.push({
            property: prop,
            timestamp: event.ts,
            type: 'read',
          });
        }
      }
      for (const prop of LAYOUT_TRIGGERING_WRITES) {
        if (frame.includes(prop)) {
          writes.push({
            property: prop,
            timestamp: event.ts,
            type: 'write',
          });
        }
      }
    }

    // If no specific properties found, add generic ones
    if (reads.length === 0) {
      reads.push({
        property: 'offsetWidth',
        timestamp: event.ts,
        type: 'read',
      });
    }
    if (writes.length === 0) {
      writes.push({
        property: 'style',
        timestamp: event.ts,
        type: 'write',
      });
    }

    return {
      frameId,
      reads,
      writes,
      forcedReflows: 1,
    };
  }

  /**
   * Create a detection from a thrashing pattern
   */
  private createDetection(
    pattern: ThrashingPattern,
    context: DetectionContext,
  ): LayoutThrashDetection {
    // Calculate trace duration in milliseconds
    const traceDurationMs =
      (context.traceEndTime - context.traceStartTime) / 1000;

    // Use ScoringService for consistent scoring
    const scoringInput: ScoringInput = {
      detectionType: 'layout_thrashing',
      durationMs: pattern.totalCostMs,
      occurrences: pattern.events.length,
      frameBudgetMs: context.frameBudgetMs,
      traceDurationMs: traceDurationMs > 0 ? traceDurationMs : 1000,
      affectedNodes: pattern.affectedNodes,
    };

    const scoringResult = this.scoringService.calculateScore(scoringInput);

    return {
      type: 'layout_thrashing',
      severity: scoringResult.severity,
      description: `Layout thrashing detected on "${pattern.selector}" with ${pattern.events.length} forced reflows costing ${pattern.totalCostMs.toFixed(2)}ms`,
      location: {
        selector: pattern.selector,
      },
      metrics: {
        durationMs: pattern.totalCostMs,
        occurrences: pattern.events.length,
        impactScore: scoringResult.impactScore,
        confidence: scoringResult.confidence,
        estimatedSpeedupPct: scoringResult.estimatedSpeedupPct,
        speedupExplanation: scoringResult.speedupExplanation,
        frameBudgetImpactPct: scoringResult.frameBudgetImpactPct,
        riskAssessment: scoringResult.riskAssessment,
      },
      evidence: [],
      selector: pattern.selector,
      reflowCostMs: pattern.totalCostMs,
      occurrences: pattern.events.length,
      affectedNodes: pattern.affectedNodes,
      readWritePattern: pattern.readWritePatterns,
    };
  }
}
