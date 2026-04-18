/**
 * LLM Context-Aware Suggester
 * Generates project-specific fix suggestions using AI
 *
 */

import { Injectable } from '@nestjs/common';
import type { Detection, Suggestion } from '../shared/types/index.js';
import type { ISuggester } from './interfaces/index.js';
import { LLMService } from '../services/llm.service.js';
import { ProjectContextService } from '../services/project-context.service.js';

@Injectable()
export class LLMContextAwareSuggester implements ISuggester {
  readonly name = 'llm-context-aware';
  readonly supportedTypes: Detection['type'][] = [
    'layout_thrashing',
    'gpu_stall',
    'long_task',
    'heavy_paint',
    'forced_reflow',
  ];

  constructor(
    private readonly llmService: LLMService,
    private readonly projectContextService: ProjectContextService,
  ) {}

  /**
   * Generate context-aware suggestion using LLM
   */
  async suggest(detection: Detection): Promise<Suggestion | null> {
    // Skip if LLM not configured
    if (!this.llmService.isConfigured()) {
      return null;
    }

    try {
      // Get project context
      const projectPath = process.cwd();
      const projectContext =
        await this.projectContextService.analyzeProject(projectPath);

      // Try to resolve and read source code
      const sourceFile = await this.projectContextService.resolveSourceFile(
        projectPath,
        detection.location?.selector,
        detection.location?.file,
      );

      let sourceCode: string | undefined;
      if (sourceFile) {
        sourceCode =
          (await this.projectContextService.getSourceCode(sourceFile)) ||
          undefined;
      }

      // Call LLM for context-aware suggestion
      const llmSuggestion =
        await this.llmService.generateContextAwareSuggestion({
          detection,
          projectContext,
          sourceCode,
          filePath: sourceFile || undefined,
        });

      if (!llmSuggestion) {
        return null;
      }

      // Calculate speedup estimate
      const speedupPct = Math.min(detection.metrics.impactScore * 0.8, 95);

      // Build proper Suggestion shape
      const suggestion: Suggestion = {
        id: `llm-${Date.now()}`,
        type: 'js',
        target:
          detection.location.selector || detection.location.file || 'unknown',
        description:
          llmSuggestion.description || 'AI-generated performance fix',
        patch: llmSuggestion.patch || '',
        estimatedSpeedupPct: speedupPct,
        speedupExplanation: `Based on ${projectContext.framework} best practices for ${detection.type}`,
        confidence: this.mapConfidence(detection.metrics.confidence),
        warnings: llmSuggestion.warnings || [],
        affectedFiles: sourceFile ? [sourceFile] : [],
      };

      return suggestion;
    } catch (error) {
      console.warn('LLM context-aware suggestion failed:', error);
      return null;
    }
  }

  private mapConfidence(
    confidence: Detection['metrics']['confidence'],
  ): Suggestion['confidence'] {
    switch (confidence) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      default:
        return 'low';
    }
  }
}
