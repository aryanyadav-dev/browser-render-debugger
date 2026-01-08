/**
 * SourceMap Service
 * Resolves stack traces to original source locations using source maps.
 * Requirements: 3.11
 */

import { Injectable } from '@nestjs/common';
import { SourceMapConsumer, RawSourceMap } from 'source-map';
import * as fs from 'fs';
import * as path from 'path';
import type { StackFrame } from '../shared/types/detection.types.js';

/**
 * Represents a location in generated (bundled/minified) code
 */
export interface GeneratedLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * Represents a location in original source code
 */
export interface OriginalLocation {
  file: string;
  line: number;
  column: number;
  name?: string;
}

// Re-export StackFrame for convenience
export type { StackFrame };

/**
 * Interface for the SourceMap service
 */
export interface ISourceMapService {
  loadSourceMaps(paths: string[]): Promise<void>;
  resolveLocation(
    location: GeneratedLocation,
  ): Promise<OriginalLocation | null>;
  resolveStackTrace(stack: StackFrame[]): Promise<StackFrame[]>;
  clearCache(): void;
  isLoaded(file: string): boolean;
}

@Injectable()
export class SourceMapService implements ISourceMapService {
  /** Cache of loaded source map consumers keyed by generated file path */
  private sourceMapCache: Map<string, SourceMapConsumer> = new Map();

  /** Cache of source map file paths keyed by generated file path */
  private sourceMapPaths: Map<string, string> = new Map();

  /**
   * Load source maps from the specified paths.
   * Supports both direct .map files and directories containing source maps.
   * @param paths Array of file or directory paths to load source maps from
   */
  async loadSourceMaps(paths: string[]): Promise<void> {
    for (const sourcePath of paths) {
      try {
        const stat = await fs.promises.stat(sourcePath);

        if (stat.isDirectory()) {
          await this.loadSourceMapsFromDirectory(sourcePath);
        } else if (sourcePath.endsWith('.map')) {
          await this.loadSourceMapFile(sourcePath);
        } else if (sourcePath.endsWith('.js') || sourcePath.endsWith('.ts')) {
          // Try to find associated source map
          await this.loadSourceMapForFile(sourcePath);
        }
      } catch (error) {
        // Skip files that don't exist or can't be read
        console.warn(
          `Warning: Could not load source map from ${sourcePath}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Resolve a generated location to its original source location.
   * @param location The generated code location
   * @returns The original location or null if not found
   */
  async resolveLocation(
    location: GeneratedLocation,
  ): Promise<OriginalLocation | null> {
    const consumer = await this.getConsumerForFile(location.file);

    if (!consumer) {
      return null;
    }

    const originalPosition = consumer.originalPositionFor({
      line: location.line,
      column: location.column,
    });

    if (originalPosition.source === null) {
      return null;
    }

    return {
      file: originalPosition.source,
      line: originalPosition.line ?? location.line,
      column: originalPosition.column ?? location.column,
      name: originalPosition.name ?? undefined,
    };
  }

  /**
   * Resolve an entire stack trace to original source locations.
   * @param stack Array of stack frames to resolve
   * @returns Array of resolved stack frames with isSourceMapped flag set
   */
  async resolveStackTrace(stack: StackFrame[]): Promise<StackFrame[]> {
    const resolvedStack: StackFrame[] = [];

    for (const frame of stack) {
      const originalLocation = await this.resolveLocation({
        file: frame.file,
        line: frame.line,
        column: frame.column,
      });

      if (originalLocation) {
        resolvedStack.push({
          functionName: originalLocation.name || frame.functionName,
          file: originalLocation.file,
          line: originalLocation.line,
          column: originalLocation.column,
          isSourceMapped: true,
        });
      } else {
        resolvedStack.push({
          ...frame,
          isSourceMapped: false,
        });
      }
    }

    return resolvedStack;
  }

  /**
   * Clear all cached source maps.
   */
  clearCache(): void {
    // Destroy all consumers to free memory
    for (const consumer of this.sourceMapCache.values()) {
      consumer.destroy();
    }
    this.sourceMapCache.clear();
    this.sourceMapPaths.clear();
  }

  /**
   * Check if a source map is loaded for a given file.
   * @param file The generated file path
   * @returns True if a source map is loaded for the file
   */
  isLoaded(file: string): boolean {
    const normalizedPath = this.normalizeFilePath(file);
    return (
      this.sourceMapCache.has(normalizedPath) ||
      this.sourceMapPaths.has(normalizedPath)
    );
  }

  /**
   * Get the number of loaded source maps.
   */
  get loadedCount(): number {
    return this.sourceMapCache.size;
  }

  /**
   * Load all source map files from a directory recursively.
   */
  private async loadSourceMapsFromDirectory(dirPath: string): Promise<void> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.loadSourceMapsFromDirectory(fullPath);
      } else if (entry.name.endsWith('.map')) {
        await this.loadSourceMapFile(fullPath);
      }
    }
  }

  /**
   * Load a single source map file.
   */
  private async loadSourceMapFile(mapPath: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(mapPath, 'utf-8');
      const rawSourceMap = JSON.parse(content) as RawSourceMap;

      // Determine the generated file path
      const generatedFile = rawSourceMap.file
        ? path.resolve(path.dirname(mapPath), rawSourceMap.file)
        : mapPath.replace(/\.map$/, '');

      const normalizedPath = this.normalizeFilePath(generatedFile);

      // Store the path for lazy loading
      this.sourceMapPaths.set(normalizedPath, mapPath);

      // Also store by the map file path itself
      const normalizedMapPath = this.normalizeFilePath(mapPath);
      this.sourceMapPaths.set(normalizedMapPath, mapPath);

      // Store by sources if available
      if (rawSourceMap.sources) {
        for (const source of rawSourceMap.sources) {
          const sourcePath = path.resolve(path.dirname(mapPath), source);
          const normalizedSourcePath = this.normalizeFilePath(sourcePath);
          this.sourceMapPaths.set(normalizedSourcePath, mapPath);
        }
      }
    } catch (error) {
      console.warn(
        `Warning: Could not parse source map ${mapPath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Try to find and load a source map for a JavaScript/TypeScript file.
   */
  private async loadSourceMapForFile(filePath: string): Promise<void> {
    // Try common source map locations
    const possibleMapPaths = [
      `${filePath}.map`,
      filePath.replace(/\.(js|ts)$/, '.js.map'),
      filePath.replace(/\.(js|ts)$/, '.map'),
    ];

    for (const mapPath of possibleMapPaths) {
      try {
        await fs.promises.access(mapPath);
        await this.loadSourceMapFile(mapPath);
        return;
      } catch {
        // Try next path
      }
    }

    // Try to read the file and look for sourceMappingURL comment
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const match = content.match(/\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/);

      if (match && match[1]) {
        const mapUrl = match[1];

        // Handle inline source maps
        if (mapUrl.startsWith('data:')) {
          await this.loadInlineSourceMap(filePath, mapUrl);
        } else {
          // Resolve relative path
          const mapPath = path.resolve(path.dirname(filePath), mapUrl);
          await this.loadSourceMapFile(mapPath);
        }
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  /**
   * Load an inline source map from a data URL.
   */
  private async loadInlineSourceMap(
    filePath: string,
    dataUrl: string,
  ): Promise<void> {
    try {
      // Parse data URL: data:application/json;base64,<data>
      const match = dataUrl.match(
        /^data:application\/json;(?:charset=utf-8;)?base64,(.+)$/,
      );

      if (!match || !match[1]) {
        return;
      }

      const base64Data = match[1];
      const jsonContent = Buffer.from(base64Data, 'base64').toString('utf-8');
      const rawSourceMap = JSON.parse(jsonContent) as RawSourceMap;

      const consumer = await new SourceMapConsumer(rawSourceMap);
      const normalizedPath = this.normalizeFilePath(filePath);
      this.sourceMapCache.set(normalizedPath, consumer);
    } catch (error) {
      console.warn(
        `Warning: Could not parse inline source map for ${filePath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get or create a SourceMapConsumer for a file.
   */
  private async getConsumerForFile(
    file: string,
  ): Promise<SourceMapConsumer | null> {
    const normalizedPath = this.normalizeFilePath(file);

    // Check if already loaded
    if (this.sourceMapCache.has(normalizedPath)) {
      return this.sourceMapCache.get(normalizedPath)!;
    }

    // Check if we have a path to load from
    const mapPath = this.sourceMapPaths.get(normalizedPath);
    if (mapPath) {
      try {
        const content = await fs.promises.readFile(mapPath, 'utf-8');
        const rawSourceMap = JSON.parse(content) as RawSourceMap;
        const consumer = await new SourceMapConsumer(rawSourceMap);
        this.sourceMapCache.set(normalizedPath, consumer);
        return consumer;
      } catch {
        return null;
      }
    }

    // Try to find source map dynamically
    await this.loadSourceMapForFile(file);

    return this.sourceMapCache.get(normalizedPath) ?? null;
  }

  /**
   * Normalize a file path for consistent cache lookups.
   */
  private normalizeFilePath(filePath: string): string {
    // Handle URLs
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      try {
        const url = new URL(filePath);
        return url.pathname;
      } catch {
        return filePath;
      }
    }

    // Handle file:// URLs
    if (filePath.startsWith('file://')) {
      return filePath.replace('file://', '');
    }

    // Normalize path separators and resolve
    return path.normalize(filePath);
  }
}
