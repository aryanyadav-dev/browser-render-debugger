/**
 * GPU Stall Detector
 * Detects GPU sync events, texture uploads, and raster stalls
 *
 * Note: This detector requires full CDP access or GPU event capability.
 * It will be skipped for webkit-native adapter which has limited GPU visibility.
 *
 * Requirements: 15.21
 */

import { Injectable } from '@nestjs/common';
import type {
  TraceData,
  TraceEvent,
  Detection,
  GPUStallDetection,
  LayerInfo,
} from '../../shared/types/index.js';
import type { IDetector, DetectionContext } from '../interfaces/index.js';
import { AdapterCapability } from '../../adapters/interfaces/index.js';
import { ScoringService, type ScoringInput } from '../scoring/index.js';

type StallType = 'sync' | 'texture_upload' | 'raster';

interface GPUEvent {
  ts: number;
  dur: number;
  name: string;
  stallType: StallType;
  element?: string;
  layerInfo?: LayerInfo;
}

interface StallPattern {
  element: string;
  events: GPUEvent[];
  totalStallMs: number;
  stallType: StallType;
  layerInfo?: LayerInfo;
}

// GPU-related event names
const GPU_SYNC_EVENTS = new Set([
  'GPUTask',
  'Gpu::SwapBuffers',
  'CommandBufferHelper::Finish',
  'GLES2DecoderImpl::DoFinish',
  'WaitForSwap',
]);

const TEXTURE_UPLOAD_EVENTS = new Set([
  'UploadTexture',
  'TextureManager::Upload',
  'AsyncTexImage2D',
  'TexImage2D',
  'TexSubImage2D',
  'CompressedTexImage2D',
]);

const RASTER_EVENTS = new Set([
  'RasterTask',
  'RasterSource::PlaybackToCanvas',
  'TileManager::ScheduleTasks',
  'RasterBufferProvider::PlaybackToMemory',
  'GpuRasterization',
  'SoftwareRasterization',
]);

@Injectable()
export class GPUStallDetector implements IDetector {
  readonly name = 'GPUStallDetector';
  readonly priority = 2;
  /** GPU stall detection requires full CDP access or GPU event capability */
  readonly requiredCapabilities = [AdapterCapability.GPU_EVENTS];

  constructor(private readonly scoringService: ScoringService) {}

  /**
   * Detect GPU stalls in trace data
   */
  detect(trace: TraceData, context: DetectionContext): Promise<Detection[]> {
    const gpuEvents = this.extractGPUEvents(trace);
    const stallPatterns = this.findStallPatterns(gpuEvents, trace);

    return Promise.resolve(
      stallPatterns.map((pattern) => this.createDetection(pattern, context)),
    );
  }

  /**
   * Extract GPU-related events from trace
   */
  private extractGPUEvents(trace: TraceData): GPUEvent[] {
    const events: GPUEvent[] = [];

    for (const event of trace.traceEvents) {
      const stallType = this.getStallType(event);
      if (stallType) {
        events.push({
          ts: event.ts,
          dur: event.dur ?? 0,
          name: event.name,
          stallType,
          element: this.extractElement(event),
          layerInfo: this.extractLayerInfo(event),
        });
      }
    }

    return events.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Determine the stall type for an event
   */
  private getStallType(event: TraceEvent): StallType | null {
    if (GPU_SYNC_EVENTS.has(event.name)) return 'sync';
    if (TEXTURE_UPLOAD_EVENTS.has(event.name)) return 'texture_upload';
    if (RASTER_EVENTS.has(event.name)) return 'raster';

    // Check category for GPU-related events
    if (event.cat?.includes('gpu')) {
      if (event.name.toLowerCase().includes('sync')) return 'sync';
      if (event.name.toLowerCase().includes('texture')) return 'texture_upload';
      if (event.name.toLowerCase().includes('raster')) return 'raster';
      return 'sync'; // Default GPU events to sync
    }

    return null;
  }

  /**
   * Extract element information from event
   */
  private extractElement(event: TraceEvent): string {
    const args = event.args;
    if (!args) return 'unknown';

    // Try various arg structures
    if (args.data && typeof args.data === 'object') {
      const data = args.data as Record<string, unknown>;
      if (typeof data.elementId === 'string') return data.elementId;
      if (typeof data.nodeId === 'string') return data.nodeId;
      if (typeof data.layerId === 'number') return `layer-${data.layerId}`;
      if (typeof data.url === 'string') {
        // Extract filename from URL
        const url = data.url;
        const parts = url.split('/');
        return parts[parts.length - 1] ?? url;
      }
    }

    if (typeof args.layerId === 'number') return `layer-${args.layerId}`;
    if (typeof args.tileId === 'string') return `tile-${args.tileId}`;

    // For texture uploads, try to get texture info
    if (
      typeof args.textureId === 'number' ||
      typeof args.textureId === 'string'
    ) {
      return `texture-${args.textureId}`;
    }

    return 'unknown';
  }

  /**
   * Extract layer information from event
   */
  private extractLayerInfo(event: TraceEvent): LayerInfo | undefined {
    const args = event.args;
    if (!args) return undefined;

    const data = (args.data ?? args) as Record<string, unknown>;

    if (typeof data.layerId !== 'number') return undefined;

    const bounds = data.bounds as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    const compositingReasons = data.compositingReasons as string[] | undefined;

    return {
      layerId: data.layerId,
      bounds: {
        x: bounds?.x ?? 0,
        y: bounds?.y ?? 0,
        width: bounds?.width ?? 0,
        height: bounds?.height ?? 0,
      },
      compositingReasons: compositingReasons ?? [],
    };
  }

  /**
   * Find stall patterns from GPU events
   */
  private findStallPatterns(
    gpuEvents: GPUEvent[],
    trace: TraceData,
  ): StallPattern[] {
    const patterns = new Map<string, StallPattern>();

    // Minimum stall duration to consider (in microseconds)
    const minStallUs = 1000; // 1ms

    for (const event of gpuEvents) {
      if (event.dur < minStallUs) continue;

      // Check if this stall blocks the main thread
      if (!this.isBlockingMainThread(event, trace)) continue;

      const key = `${event.element}-${event.stallType}`;
      const existing = patterns.get(key);

      if (existing) {
        existing.events.push(event);
        existing.totalStallMs += event.dur / 1000;
        if (event.layerInfo && !existing.layerInfo) {
          existing.layerInfo = event.layerInfo;
        }
      } else {
        patterns.set(key, {
          element: event.element ?? 'unknown',
          events: [event],
          totalStallMs: event.dur / 1000,
          stallType: event.stallType,
          layerInfo: event.layerInfo,
        });
      }
    }

    // Filter patterns that meet minimum threshold
    return Array.from(patterns.values()).filter(
      (p) => p.totalStallMs >= 5 || p.events.length >= 3,
    );
  }

  /**
   * Check if GPU event is blocking the main thread
   */
  private isBlockingMainThread(event: GPUEvent, trace: TraceData): boolean {
    // Find main thread ID
    const mainThreadId = this.findMainThreadId(trace);
    if (mainThreadId === null) return true; // Assume blocking if we can't determine

    // Check if there are main thread events during this GPU event
    const eventEnd = event.ts + event.dur;

    for (const traceEvent of trace.traceEvents) {
      if (traceEvent.tid !== mainThreadId) continue;
      if (traceEvent.ts >= event.ts && traceEvent.ts < eventEnd) {
        // Main thread has events during GPU work - check if they're waiting
        if (
          traceEvent.name.includes('Wait') ||
          traceEvent.name.includes('Sync') ||
          traceEvent.name.includes('Idle')
        ) {
          return true;
        }
      }
    }

    // For sync events, assume they block
    return event.stallType === 'sync';
  }

  /**
   * Find the main thread ID from trace
   */
  private findMainThreadId(trace: TraceData): number | null {
    // Look for thread_name metadata
    for (const event of trace.traceEvents) {
      if (event.name === 'thread_name' && event.ph === 'M') {
        const args = event.args as { name?: string } | undefined;
        if (
          args?.name === 'CrRendererMain' ||
          args?.name === 'CrBrowserMain' ||
          args?.name === 'main'
        ) {
          return event.tid;
        }
      }
    }

    // Fallback: find thread with most events
    const threadCounts = new Map<number, number>();
    for (const event of trace.traceEvents) {
      threadCounts.set(event.tid, (threadCounts.get(event.tid) ?? 0) + 1);
    }

    let maxCount = 0;
    let mainThread: number | null = null;
    for (const [tid, count] of threadCounts) {
      if (count > maxCount) {
        maxCount = count;
        mainThread = tid;
      }
    }

    return mainThread;
  }

  /**
   * Create a detection from a stall pattern
   */
  private createDetection(
    pattern: StallPattern,
    context: DetectionContext,
  ): GPUStallDetection {
    // Calculate trace duration in milliseconds
    const traceDurationMs =
      (context.traceEndTime - context.traceStartTime) / 1000;

    // Use ScoringService for consistent scoring
    const scoringInput: ScoringInput = {
      detectionType: 'gpu_stall',
      durationMs: pattern.totalStallMs,
      occurrences: pattern.events.length,
      frameBudgetMs: context.frameBudgetMs,
      traceDurationMs: traceDurationMs > 0 ? traceDurationMs : 1000,
      stallType: pattern.stallType,
    };

    const scoringResult = this.scoringService.calculateScore(scoringInput);

    const stallTypeDescription = {
      sync: 'GPU sync',
      texture_upload: 'texture upload',
      raster: 'rasterization',
    };

    return {
      type: 'gpu_stall',
      severity: scoringResult.severity,
      description: `GPU stall (${stallTypeDescription[pattern.stallType]}) on "${pattern.element}" causing ${pattern.totalStallMs.toFixed(2)}ms of blocking`,
      location: {
        element: pattern.element,
      },
      metrics: {
        durationMs: pattern.totalStallMs,
        occurrences: pattern.events.length,
        impactScore: scoringResult.impactScore,
        confidence: scoringResult.confidence,
        estimatedSpeedupPct: scoringResult.estimatedSpeedupPct,
        speedupExplanation: scoringResult.speedupExplanation,
        frameBudgetImpactPct: scoringResult.frameBudgetImpactPct,
        riskAssessment: scoringResult.riskAssessment,
      },
      evidence: [],
      element: pattern.element,
      stallMs: pattern.totalStallMs,
      occurrences: pattern.events.length,
      stallType: pattern.stallType,
      layerInfo: pattern.layerInfo,
    };
  }
}
