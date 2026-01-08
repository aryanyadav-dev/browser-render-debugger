/**
 * Patch Generator Service
 * Creates diff patches from suggestions
 *
 * Requirements: 5.1, 5.2
 * - Generate patches for top N issues
 * - Apply safety heuristics to ensure patches are safe
 */

import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import type {
  Suggestion,
  CSSSuggestion,
  JSSuggestion,
} from '../shared/types/suggestion.types.js';
import type { Patch, PatchHunk } from '../shared/types/patch.types.js';
import type {
  IPatchGenerator,
  PatchGenerationOptions,
} from './interfaces/index.js';
import { StorageService } from '../services/storage.service.js';

/**
 * Default options for patch generation
 */
const DEFAULT_OPTIONS: Required<PatchGenerationOptions> = {
  maxPatches: 10,
  highConfidenceOnly: false,
};

@Injectable()
export class PatchGeneratorService implements IPatchGenerator {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Generate patches from suggestions
   */
  async generatePatches(
    suggestions: Suggestion[],
    options?: PatchGenerationOptions,
  ): Promise<Patch[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const patches: Patch[] = [];

    // Filter by confidence if requested
    let filteredSuggestions = suggestions;
    if (opts.highConfidenceOnly) {
      filteredSuggestions = suggestions.filter((s) => s.confidence === 'high');
    }

    // Limit to max patches
    const limitedSuggestions = filteredSuggestions.slice(0, opts.maxPatches);

    // Generate patches for each suggestion
    for (const suggestion of limitedSuggestions) {
      const patch = await this.generatePatch(suggestion);
      if (patch) {
        patches.push(patch);
      }
    }

    return patches;
  }

  /**
   * Generate a single patch from a suggestion
   */
  async generatePatch(suggestion: Suggestion): Promise<Patch | null> {
    try {
      if (suggestion.type === 'css') {
        return await this.generateCSSPatch(suggestion as CSSSuggestion);
      } else if (suggestion.type === 'js') {
        return await this.generateJSPatch(suggestion as JSSuggestion);
      }
      return null;
    } catch (error) {
      console.warn(
        `Failed to generate patch for suggestion ${suggestion.id}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Generate a CSS patch
   */
  private async generateCSSPatch(
    suggestion: CSSSuggestion,
  ): Promise<Patch | null> {
    const filePath = this.extractFilePath(suggestion.target);
    if (!filePath) return null;

    // Check if file exists
    const exists = await this.fileExists(filePath);
    if (!exists) {
      console.warn(`CSS file not found: ${filePath}`);
      return null;
    }

    // Read the file content
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the rule to modify
    const hunk = this.findCSSRule(
      lines,
      suggestion.originalRule,
      suggestion.suggestedRule,
    );
    if (!hunk) {
      console.warn(`Could not find CSS rule to modify in ${filePath}`);
      return null;
    }

    return {
      id: this.generatePatchId(),
      suggestionId: suggestion.id,
      filePath,
      hunks: [hunk],
      type: 'css',
    };
  }

  /**
   * Generate a JS patch
   */
  private async generateJSPatch(
    suggestion: JSSuggestion,
  ): Promise<Patch | null> {
    const filePath = this.extractFilePath(suggestion.target);
    if (!filePath) return null;

    // Check if file exists
    const exists = await this.fileExists(filePath);
    if (!exists) {
      console.warn(`JS file not found: ${filePath}`);
      return null;
    }

    // Read the file content
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find the code to modify
    const hunk = this.findJSCode(
      lines,
      suggestion.codeSnippet,
      suggestion.suggestedCode,
    );
    if (!hunk) {
      console.warn(`Could not find JS code to modify in ${filePath}`);
      return null;
    }

    return {
      id: this.generatePatchId(),
      suggestionId: suggestion.id,
      filePath,
      hunks: [hunk],
      type: 'js',
    };
  }

  /**
   * Find a CSS rule in the file and create a hunk
   */
  private findCSSRule(
    lines: string[],
    originalRule: string,
    suggestedRule: string,
  ): PatchHunk | null {
    const normalizedOriginal = this.normalizeCSS(originalRule);

    // Try to find the rule in the file
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const lineContent = line.trim();

      // Check if this line contains the selector or property
      if (this.normalizeCSS(lineContent).includes(normalizedOriginal)) {
        return {
          startLine: i + 1,
          endLine: i + 1,
          originalContent: line,
          newContent: line.replace(originalRule.trim(), suggestedRule.trim()),
        };
      }
    }

    // Try multi-line matching
    const fullContent = lines.join('\n');
    const normalizedContent = this.normalizeCSS(fullContent);
    const index = normalizedContent.indexOf(normalizedOriginal);

    if (index !== -1) {
      // Find the line number
      const beforeMatch = fullContent.substring(0, index);
      const startLine = beforeMatch.split('\n').length;
      const originalLines = originalRule.split('\n').length;

      return {
        startLine,
        endLine: startLine + originalLines - 1,
        originalContent: originalRule,
        newContent: suggestedRule,
      };
    }

    return null;
  }

  /**
   * Find JS code in the file and create a hunk
   */
  private findJSCode(
    lines: string[],
    codeSnippet: string,
    suggestedCode: string,
  ): PatchHunk | null {
    const normalizedSnippet = this.normalizeJS(codeSnippet);

    // Try to find the code in the file
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const lineContent = line;

      // Check if this line contains the code snippet
      if (this.normalizeJS(lineContent).includes(normalizedSnippet)) {
        return {
          startLine: i + 1,
          endLine: i + 1,
          originalContent: line,
          newContent: line.replace(codeSnippet.trim(), suggestedCode.trim()),
        };
      }
    }

    // Try multi-line matching
    const fullContent = lines.join('\n');
    const normalizedContent = this.normalizeJS(fullContent);
    const index = normalizedContent.indexOf(normalizedSnippet);

    if (index !== -1) {
      // Find the line number
      const beforeMatch = fullContent.substring(0, index);
      const startLine = beforeMatch.split('\n').length;
      const originalLines = codeSnippet.split('\n').length;

      return {
        startLine,
        endLine: startLine + originalLines - 1,
        originalContent: codeSnippet,
        newContent: suggestedCode,
      };
    }

    return null;
  }

  /**
   * Normalize CSS for comparison
   */
  private normalizeCSS(css: string): string {
    return css
      .replace(/\s+/g, ' ')
      .replace(/\s*{\s*/g, '{')
      .replace(/\s*}\s*/g, '}')
      .replace(/\s*:\s*/g, ':')
      .replace(/\s*;\s*/g, ';')
      .trim()
      .toLowerCase();
  }

  /**
   * Normalize JS for comparison
   */
  private normalizeJS(js: string): string {
    return js.replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract file path from target string
   */
  private extractFilePath(target: string): string | null {
    // Target might be in format "file.css:selector" or just "file.css"
    const parts = target.split(':');
    const filePath = parts[0];

    // Validate it looks like a file path
    if (
      !filePath ||
      (!filePath.endsWith('.css') &&
        !filePath.endsWith('.js') &&
        !filePath.endsWith('.ts'))
    ) {
      return null;
    }

    return filePath;
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a unique patch ID
   */
  private generatePatchId(): string {
    return `patch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Write patches to disk
   */
  async writePatchesToDisk(patches: Patch[]): Promise<string[]> {
    const patchPaths: string[] = [];

    for (const patch of patches) {
      const patchContent = this.formatPatchContent(patch);
      const patchPath = await this.storageService.writePatch(
        patch.id,
        patchContent,
      );
      patchPaths.push(patchPath);
    }

    return patchPaths;
  }

  /**
   * Format patch content in unified diff format
   */
  private formatPatchContent(patch: Patch): string {
    const lines: string[] = [];

    lines.push(`--- a/${patch.filePath}`);
    lines.push(`+++ b/${patch.filePath}`);

    for (const hunk of patch.hunks) {
      const originalLines = hunk.originalContent.split('\n');
      const newLines = hunk.newContent.split('\n');

      lines.push(
        `@@ -${hunk.startLine},${originalLines.length} +${hunk.startLine},${newLines.length} @@`,
      );

      for (const line of originalLines) {
        lines.push(`-${line}`);
      }

      for (const line of newLines) {
        lines.push(`+${line}`);
      }
    }

    return lines.join('\n');
  }
}
