/**
 * LLM Novel Pattern Detector
 * Uses AI to detect performance patterns not covered by rule-based detectors
 *
 */

import { Injectable } from '@nestjs/common';
import type { TraceData, Detection } from '../../shared/types/index.js';
import type { IDetector, DetectionContext } from '../interfaces/index.js';
import { LLMService } from '../../services/llm.service.js';
import { ProjectContextService } from '../../services/project-context.service.js';
import { AdapterCapability } from '../../adapters/interfaces/index.js';
import { ScoringService } from '../scoring/index.js';

@Injectable()
export class LLMNovelPatternDetector implements IDetector {
  readonly name = 'LLMNovelPatternDetector';
  readonly priority = 5; // Run after rule-based detectors
  readonly requiredCapabilities: AdapterCapability[] = [];

  constructor(
    private readonly llmService: LLMService,
    private readonly projectContextService: ProjectContextService,
    private readonly scoringService: ScoringService,
  ) {}

  /**
   * Detect novel patterns using LLM analysis
   */
  async detect(
    trace: TraceData,
    context: DetectionContext,
  ): Promise<Detection[]> {
    // Skip if LLM not configured
    if (!this.llmService.isConfigured()) {
      return [];
    }

    // Get project context for better analysis
    const projectPath = process.cwd();
    const projectContext =
      await this.projectContextService.analyzeProject(projectPath);

    // Sample trace events for LLM analysis (to stay within token limits)
    const sampledEvents = this.sampleTraceEvents(trace.traceEvents, 100);

    // Call LLM for novel pattern detection
    const novelDetections = await this.llmService.detectNovelPatterns({
      traceEvents: sampledEvents,
      existingDetections: [], // Will be populated by orchestrator
      projectContext,
    });

    // Score and validate detections
    const scoredDetections = novelDetections.map((detection) =>
      this.scoreDetection(detection, context),
    );

    return scoredDetections;
  }

  /**
   * Sample trace events to fit within LLM context window
   */
  private sampleTraceEvents(
    events: TraceData['traceEvents'],
    maxCount: number,
  ): TraceData['traceEvents'] {
    if (events.length <= maxCount) {
      return events;
    }

    // Prioritize interesting events
    const prioritizedEvents = events.filter((e) => this.isInterestingEvent(e));

    if (prioritizedEvents.length >= maxCount) {
      return this.stratifiedSample(prioritizedEvents, maxCount);
    }

    // Fill with remaining events
    const remaining = events.filter((e) => !this.isInterestingEvent(e));
    const needed = maxCount - prioritizedEvents.length;
    const sampledRemaining = this.stratifiedSample(remaining, needed);

    return [...prioritizedEvents, ...sampledRemaining];
  }

  private isInterestingEvent(event: TraceData['traceEvents'][0]): boolean {
    const interestingNames = [
      'FunctionCall',
      'EvaluateScript',
      'v8.run',
      'V8.Execute',
      'Layout',
      'RecalculateStyle',
      'Paint',
      'Composite',
      'RunTask',
      'TimerFire',
      'EventDispatch',
      'RequestAnimationFrame',
      'FireAnimationFrame',
    ];
    return interestingNames.some((name) => event.name.includes(name));
  }

  private stratifiedSample<T>(array: T[], count: number): T[] {
    if (array.length <= count) {
      return array;
    }

    const step = array.length / count;
    const sampled: T[] = [];

    for (let i = 0; i < count; i++) {
      const index = Math.floor(i * step);
      sampled.push(array[index]!);
    }

    return sampled;
  }

  private scoreDetection(
    detection: Detection,
    context: DetectionContext,
  ): Detection {
    const scoringInput = {
      detectionType:
        detection.type as import('../scoring/index.js').ScoringDetectionType,
      durationMs: detection.metrics.durationMs,
      occurrences: detection.metrics.occurrences,
      frameBudgetMs: context.frameBudgetMs,
      traceDurationMs: context.traceEndTime - context.traceStartTime,
    };

    const score = this.scoringService.calculateScore(scoringInput);

    return {
      ...detection,
      metrics: {
        ...detection.metrics,
        impactScore: score.impactScore,
      },
    };
  }
}
