/**
 * Heavy Paint Detector
 * Detects expensive paint and rasterization events
 *
 * Requirements: 15.20
 */

import { Injectable } from '@nestjs/common';
import type {
  TraceData,
  TraceEvent,
  Detection,
  HeavyPaintDetection,
} from '../../shared/types/index.js';
import type { IDetector, DetectionContext } from '../interfaces/index.js';
import { AdapterCapability } from '../../adapters/interfaces/index.js';
import { ScoringService, type ScoringInput } from '../scoring/index.js';

interface PaintEvent {
  ts: number;
  dur: number;
  type: 'paint' | 'raster';
  layerCount?: number;
  clipRect?: { x: number; y: number; width: number; height: number };
}

interface PaintPattern {
  events: PaintEvent[];
  totalPaintMs: number;
  totalRasterMs: number;
  maxLayerCount: number;
}

// Paint-related event names
const PAINT_EVENTS = new Set([
  'Paint',
  'PaintImage',
  'PaintSetup',
  'PaintNonDefaultBackgroundColor',
  'Layerize',
  'UpdateLayer',
  'UpdateLayerTree',
]);

// Rasterization-related event names
const RASTER_EVENTS = new Set([
  'RasterTask',
  'Rasterize',
  'RasterSource::PlaybackToCanvas',
  'TileManager::ScheduleTasks',
  'RasterBufferProvider::PlaybackToMemory',
  'ImageDecodeTask',
  'DecodeImage',
  'DecodeLazyPixelRef',
]);

// Minimum paint duration to consider (in microseconds)
const MIN_PAINT_DURATION_US = 2000; // 2ms

@Injectable()
export class HeavyPaintDetector implements IDetector {
  readonly name = 'HeavyPaintDetector';
  readonly priority = 4;
  /** Heavy paint detection requires paint event capability */
  readonly requiredCapabilities = [AdapterCapability.PAINT_EVENTS];

  constructor(private readonly scoringService: ScoringService) {}

  /**
   * Detect heavy paint operations in trace data
   */
  detect(trace: TraceData, context: DetectionContext): Promise<Detection[]> {
    const paintEvents = this.extractPaintEvents(trace);
    const patterns = this.findHeavyPaintPatterns(paintEvents, context);

    return Promise.resolve(
      patterns.map((pattern) => this.createDetection(pattern, context)),
    );
  }

  /**
   * Extract paint-related events from trace
   */
  private extractPaintEvents(trace: TraceData): PaintEvent[] {
    const events: PaintEvent[] = [];

    for (const event of trace.traceEvents) {
      if (PAINT_EVENTS.has(event.name)) {
        events.push({
          ts: event.ts,
          dur: event.dur ?? 0,
          type: 'paint',
          layerCount: this.extractLayerCount(event),
          clipRect: this.extractClipRect(event),
        });
      } else if (RASTER_EVENTS.has(event.name)) {
        events.push({
          ts: event.ts,
          dur: event.dur ?? 0,
          type: 'raster',
          layerCount: this.extractLayerCount(event),
        });
      }
    }

    return events.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Extract layer count from event
   */
  private extractLayerCount(event: TraceEvent): number {
    const args = event.args;
    if (!args) return 1;

    if (args.data && typeof args.data === 'object') {
      const data = args.data as Record<string, unknown>;
      if (typeof data.layerCount === 'number') return data.layerCount;
      if (typeof data.numLayers === 'number') return data.numLayers;
    }

    if (typeof args.layerCount === 'number') return args.layerCount;

    return 1;
  }

  /**
   * Extract clip rectangle from event
   */
  private extractClipRect(
    event: TraceEvent,
  ): { x: number; y: number; width: number; height: number } | undefined {
    const args = event.args;
    if (!args) return undefined;

    const data = (args.data ?? args) as Record<string, unknown>;
    const clip = data.clip as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;

    if (clip && typeof clip === 'object') {
      return {
        x: clip.x ?? 0,
        y: clip.y ?? 0,
        width: clip.width ?? 0,
        height: clip.height ?? 0,
      };
    }

    return undefined;
  }

  /**
   * Find heavy paint patterns
   */
  private findHeavyPaintPatterns(
    paintEvents: PaintEvent[],
    context: DetectionContext,
  ): PaintPattern[] {
    // Group events by frame
    const frameGroups = this.groupEventsByFrame(paintEvents, context);
    const patterns: PaintPattern[] = [];

    for (const events of frameGroups.values()) {
      const totalPaintMs = events
        .filter((e) => e.type === 'paint')
        .reduce((sum, e) => sum + e.dur / 1000, 0);

      const totalRasterMs = events
        .filter((e) => e.type === 'raster')
        .reduce((sum, e) => sum + e.dur / 1000, 0);

      const maxLayerCount = Math.max(...events.map((e) => e.layerCount ?? 1));

      // Only include if paint/raster time is significant
      if (
        totalPaintMs + totalRasterMs >= MIN_PAINT_DURATION_US / 1000 ||
        maxLayerCount > 10
      ) {
        patterns.push({
          events,
          totalPaintMs,
          totalRasterMs,
          maxLayerCount,
        });
      }
    }

    // Aggregate patterns if there are many similar ones
    if (patterns.length > 5) {
      return [this.aggregatePatterns(patterns)];
    }

    return patterns;
  }

  /**
   * Group paint events by frame
   */
  private groupEventsByFrame(
    paintEvents: PaintEvent[],
    context: DetectionContext,
  ): Map<number, PaintEvent[]> {
    const frameGroups = new Map<number, PaintEvent[]>();
    const windowUs = context.frameBudgetMs * 1000;

    for (const event of paintEvents) {
      const frameId = Math.floor(
        (event.ts - context.traceStartTime) / windowUs,
      );
      const existing = frameGroups.get(frameId) ?? [];
      existing.push(event);
      frameGroups.set(frameId, existing);
    }

    return frameGroups;
  }

  /**
   * Aggregate multiple patterns into one
   */
  private aggregatePatterns(patterns: PaintPattern[]): PaintPattern {
    const allEvents = patterns.flatMap((p) => p.events);
    const totalPaintMs = patterns.reduce((sum, p) => sum + p.totalPaintMs, 0);
    const totalRasterMs = patterns.reduce((sum, p) => sum + p.totalRasterMs, 0);
    const maxLayerCount = Math.max(...patterns.map((p) => p.maxLayerCount));

    return {
      events: allEvents,
      totalPaintMs,
      totalRasterMs,
      maxLayerCount,
    };
  }

  /**
   * Create a detection from a paint pattern
   */
  private createDetection(
    pattern: PaintPattern,
    context: DetectionContext,
  ): HeavyPaintDetection {
    // Calculate trace duration in milliseconds
    const traceDurationMs =
      (context.traceEndTime - context.traceStartTime) / 1000;
    const totalTimeMs = pattern.totalPaintMs + pattern.totalRasterMs;

    // Use ScoringService for consistent scoring
    const scoringInput: ScoringInput = {
      detectionType: 'heavy_paint',
      durationMs: totalTimeMs,
      occurrences: pattern.events.length,
      frameBudgetMs: context.frameBudgetMs,
      traceDurationMs: traceDurationMs > 0 ? traceDurationMs : 1000,
      layerCount: pattern.maxLayerCount,
    };

    const scoringResult = this.scoringService.calculateScore(scoringInput);

    return {
      type: 'heavy_paint',
      severity: scoringResult.severity,
      description: `Heavy paint operations: ${pattern.totalPaintMs.toFixed(1)}ms paint, ${pattern.totalRasterMs.toFixed(1)}ms raster across ${pattern.maxLayerCount} layers`,
      location: {},
      metrics: {
        durationMs: totalTimeMs,
        occurrences: pattern.events.length,
        impactScore: scoringResult.impactScore,
        confidence: scoringResult.confidence,
        estimatedSpeedupPct: scoringResult.estimatedSpeedupPct,
        speedupExplanation: scoringResult.speedupExplanation,
        frameBudgetImpactPct: scoringResult.frameBudgetImpactPct,
        riskAssessment: scoringResult.riskAssessment,
      },
      evidence: [],
      paintTimeMs: pattern.totalPaintMs,
      rasterTimeMs: pattern.totalRasterMs,
      layerCount: pattern.maxLayerCount,
    };
  }
}
