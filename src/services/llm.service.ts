/**
 * LLM Service
 * Integrates with OpenAI/Anthropic/Google Gemini for novel pattern detection and context-aware suggestions
 */

import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Detection,
  Suggestion,
  TraceEvent,
} from '../shared/types/index.js';

export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface NovelPatternRequest {
  traceEvents: TraceEvent[];
  existingDetections: Detection[];
  projectContext?: ProjectContext;
}

export interface ProjectContext {
  framework: string;
  bundler: string;
  hasSSR: boolean;
  hasTypeScript: boolean;
  componentCount: number;
  averageBundleSize: number;
  dependencies: string[];
}

export interface ContextAwareSuggestionRequest {
  detection: Detection;
  projectContext: ProjectContext;
  sourceCode?: string;
  filePath?: string;
}

@Injectable()
export class LLMService {
  private openaiClient: OpenAI | null = null;
  private geminiClient: GoogleGenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private config: LLMConfig | null = null;

  constructor() {
    this.initializeFromEnv();
  }

  private initializeFromEnv(): void {
    // Check for Gemini API key first (newest addition)
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      this.config = {
        provider: 'gemini',
        apiKey: geminiKey,
        model: process.env.LLM_MODEL || 'gemini-1.5-flash',
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
      };
      this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });
      return;
    }

    // Check for OpenAI
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      this.config = {
        provider: 'openai',
        apiKey: openaiKey,
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
      };
      this.openaiClient = new OpenAI({ apiKey: openaiKey });
      return;
    }

    // Check for Anthropic
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.config = {
        provider: 'anthropic',
        apiKey: anthropicKey,
        model: process.env.LLM_MODEL || 'claude-3-haiku-20240307',
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
      };
      this.anthropicClient = new Anthropic({ apiKey: anthropicKey });
      return;
    }
  }

  isConfigured(): boolean {
    return (
      this.config !== null &&
      (this.openaiClient !== null ||
        this.geminiClient !== null ||
        this.anthropicClient !== null)
    );
  }

  private getActiveProvider(): LLMProvider | null {
    return this.config?.provider || null;
  }

  /**
   * Detect novel performance patterns not covered by rule-based detectors
   */
  async detectNovelPatterns(
    request: NovelPatternRequest,
  ): Promise<Detection[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const prompt = this.buildNovelPatternPrompt(request);
    const provider = this.getActiveProvider();

    try {
      let content: string | null = null;

      if (provider === 'gemini' && this.geminiClient) {
        // Gemini API
        const result = await this.geminiClient.models.generateContent({
          model: this.config!.model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'You are a web performance expert. Analyze trace events and identify performance issues not covered by standard detectors. Return only valid JSON.\n\n' +
                    prompt,
                },
              ],
            },
          ],
          config: {
            maxOutputTokens: this.config!.maxTokens,
            temperature: this.config!.temperature,
            responseMimeType: 'application/json',
          },
        });
        content = result.text || null;
      } else if (provider === 'openai' && this.openaiClient) {
        // OpenAI API
        const response = await this.openaiClient.chat.completions.create({
          model: this.config!.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a web performance expert. Analyze trace events and identify performance issues not covered by standard detectors. Return only valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: this.config!.maxTokens,
          temperature: this.config!.temperature,
          response_format: { type: 'json_object' },
        });
        content = response.choices[0]?.message?.content || null;
      } else if (provider === 'anthropic' && this.anthropicClient) {
        // Anthropic API
        const response = await this.anthropicClient.messages.create({
          model: this.config!.model,
          max_tokens: this.config!.maxTokens,
          temperature: this.config!.temperature,
          system:
            'You are a web performance expert. Analyze trace events and identify performance issues not covered by standard detectors. Return only valid JSON.',
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
        const textContent = response.content[0];
        content =
          textContent && textContent.type === 'text' ? textContent.text : null;
      }

      if (!content) {
        return [];
      }

      const result = JSON.parse(content) as { detections: Detection[] };
      return result.detections || [];
    } catch (error) {
      console.warn('LLM pattern detection failed:', error);
      return [];
    }
  }

  /**
   * Generate context-aware fix suggestions tailored to the project
   */
  async generateContextAwareSuggestion(
    request: ContextAwareSuggestionRequest,
  ): Promise<Partial<Suggestion> | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const prompt = this.buildContextAwarePrompt(request);
    const provider = this.getActiveProvider();

    try {
      let content: string | null = null;

      if (provider === 'gemini' && this.geminiClient) {
        // Gemini API
        const result = await this.geminiClient.models.generateContent({
          model: this.config!.model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'You are a web performance expert. Given a performance issue and project context, suggest a specific, actionable fix tailored to the technology stack. Return only valid JSON.\n\n' +
                    prompt,
                },
              ],
            },
          ],
          config: {
            maxOutputTokens: this.config!.maxTokens,
            temperature: this.config!.temperature,
            responseMimeType: 'application/json',
          },
        });
        content = result.text || null;
      } else if (provider === 'openai' && this.openaiClient) {
        // OpenAI API
        const response = await this.openaiClient.chat.completions.create({
          model: this.config!.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a web performance expert. Given a performance issue and project context, suggest a specific, actionable fix tailored to the technology stack. Return only valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: this.config!.maxTokens,
          temperature: this.config!.temperature,
          response_format: { type: 'json_object' },
        });
        content = response.choices[0]?.message?.content || null;
      } else if (provider === 'anthropic' && this.anthropicClient) {
        // Anthropic API
        const response = await this.anthropicClient.messages.create({
          model: this.config!.model,
          max_tokens: this.config!.maxTokens,
          temperature: this.config!.temperature,
          system:
            'You are a web performance expert. Given a performance issue and project context, suggest a specific, actionable fix tailored to the technology stack. Return only valid JSON.',
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
        const textContent = response.content[0];
        content =
          textContent && textContent.type === 'text' ? textContent.text : null;
      }

      if (!content) {
        return null;
      }

      const result = JSON.parse(content) as { suggestion: Partial<Suggestion> };
      return result.suggestion || null;
    } catch (error) {
      console.warn('LLM suggestion generation failed:', error);
      return null;
    }
  }

  private buildNovelPatternPrompt(request: NovelPatternRequest): string {
    const { traceEvents, existingDetections, projectContext } = request;

    return `Analyze these Chrome DevTools trace events and identify any performance issues NOT already covered by the existing detections.

Existing detections (${existingDetections.length} found):
${existingDetections.map((d) => `- ${d.type}: ${d.description}`).join('\n')}

Trace events (sample):
${JSON.stringify(traceEvents.slice(0, 50), null, 2)}

${projectContext ? `Project context:\n- Framework: ${projectContext.framework}\n- Bundler: ${projectContext.bundler}\n- SSR: ${projectContext.hasSSR}\n- Components: ${projectContext.componentCount}` : ''}

Look for:
1. Unusual timing patterns
2. Framework-specific issues (React reconciliation, Vue reactivity, etc.)
3. Resource loading anomalies
4. JavaScript execution hotspots not covered by long task detector
5. Custom animation/frame timing issues
6. Memory pressure indicators in timing

Return JSON format:
{
  "detections": [
    {
      "type": "novel_pattern_name",
      "severity": "warning|high|critical",
      "description": "Clear description of the issue",
      "location": { "file": "path/to/file", "line": 42 },
      "metrics": { "impactScore": 75, "durationMs": 150, "occurrences": 5 },
      "confidence": "medium",
      "evidence": []
    }
  ]
}`;
  }

  private buildContextAwarePrompt(
    request: ContextAwareSuggestionRequest,
  ): string {
    const { detection, projectContext, sourceCode, filePath } = request;

    return `Given this performance issue and project context, suggest a SPECIFIC fix tailored to the technology stack.

Performance Issue:
- Type: ${detection.type}
- Description: ${detection.description}
- Impact Score: ${detection.metrics.impactScore}/100
- Location: ${filePath || 'unknown'}

Project Context:
- Framework: ${projectContext.framework}
- Bundler: ${projectContext.bundler}
- Has SSR: ${projectContext.hasSSR}
- Has TypeScript: ${projectContext.hasTypeScript}
- Component Count: ${projectContext.componentCount}
- Average Bundle Size: ${projectContext.averageBundleSize}KB
- Key Dependencies: ${projectContext.dependencies.slice(0, 10).join(', ')}

${sourceCode ? `Source code at issue location:\n\`\`\`\n${sourceCode.slice(0, 500)}\n\`\`\`` : ''}

Provide a fix that:
1. Is idiomatic for ${projectContext.framework}
2. Considers ${projectContext.hasSSR ? 'SSR implications' : 'client-side only'}
3. Uses ${projectContext.hasTypeScript ? 'TypeScript best practices' : 'JavaScript best practices'}
4. Addresses the specific performance bottleneck

Return JSON format:
{
  "suggestion": {
    "title": "Brief fix title",
    "description": "Detailed explanation",
    "fix": {
      "type": "code_change|configuration|dependency",
      "code": "specific code to implement",
      "explanation": "why this fixes the issue",
      "estimatedSpeedup": 30,
      "warnings": ["potential side effects or considerations"]
    },
    "confidence": "high|medium|low",
    "documentation": "https://relevant-docs-link"
  }
}`;
  }
}
