/**
 * Project Context Service
 * Analyzes the codebase to understand framework, dependencies, and architecture
 *
 */

import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

export interface ProjectContext {
  framework:
    | 'react'
    | 'vue'
    | 'angular'
    | 'svelte'
    | 'solid'
    | 'preact'
    | 'next'
    | 'nuxt'
    | 'generic';
  bundler:
    | 'webpack'
    | 'vite'
    | 'rollup'
    | 'esbuild'
    | 'parcel'
    | 'turbo'
    | 'unknown';
  hasSSR: boolean;
  hasTypeScript: boolean;
  componentCount: number;
  averageBundleSize: number;
  dependencies: string[];
  devDependencies: string[];
  configFiles: string[];
  entryPoints: string[];
}

export interface FileInfo {
  path: string;
  size: number;
  imports: string[];
  exports: string[];
  isComponent: boolean;
}

@Injectable()
export class ProjectContextService {
  private cache: Map<string, ProjectContext> = new Map();

  /**
   * Analyze project structure and return context
   */
  async analyzeProject(projectPath: string): Promise<ProjectContext> {
    const cached = this.cache.get(projectPath);
    if (cached) {
      return cached;
    }

    const context = await this.detectFramework(projectPath);
    this.cache.set(projectPath, context);
    return context;
  }

  /**
   * Get source code for a specific file (for LLM context)
   */
  async getSourceCode(filePath: string): Promise<string | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Find the source file for a given detection location
   */
  async resolveSourceFile(
    projectPath: string,
    selector?: string,
    fileHint?: string,
  ): Promise<string | null> {
    // Try direct file path first
    if (fileHint) {
      const directPath = path.resolve(projectPath, fileHint);
      if (fs.existsSync(directPath)) {
        return directPath;
      }
    }

    // Try to find by selector pattern (component name, etc.)
    if (selector) {
      const possibleFiles = await this.findFilesBySelector(
        projectPath,
        selector,
      );
      if (possibleFiles.length > 0 && possibleFiles[0]) {
        return possibleFiles[0];
      }
    }

    // Search common source directories
    const srcDirs = ['src', 'app', 'pages', 'components', 'lib'];
    for (const dir of srcDirs) {
      const fullDir = path.join(projectPath, dir);
      if (fs.existsSync(fullDir)) {
        const files = await this.findSourceFiles(fullDir);
        if (files.length > 0 && files[0]) {
          return files[0];
        }
      }
    }

    return null;
  }

  private async detectFramework(projectPath: string): Promise<ProjectContext> {
    const packageJsonPath = path.join(projectPath, 'package.json');
    let dependencies: string[] = [];
    let devDependencies: string[] = [];

    try {
      const packageContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      dependencies = Object.keys(packageJson.dependencies || {});
      devDependencies = Object.keys(packageJson.devDependencies || {});
    } catch {
      // No package.json, generic project
    }

    const allDeps = [...dependencies, ...devDependencies];

    // Detect framework
    let framework: ProjectContext['framework'] = 'generic';
    if (allDeps.includes('next')) {
      framework = 'next';
    } else if (allDeps.includes('nuxt') || allDeps.includes('nuxt3')) {
      framework = 'nuxt';
    } else if (allDeps.includes('react') || allDeps.includes('react-dom')) {
      framework = 'react';
    } else if (allDeps.includes('vue') || allDeps.includes('vue3')) {
      framework = 'vue';
    } else if (allDeps.includes('@angular/core')) {
      framework = 'angular';
    } else if (allDeps.includes('svelte')) {
      framework = 'svelte';
    } else if (allDeps.includes('solid-js')) {
      framework = 'solid';
    } else if (allDeps.includes('preact')) {
      framework = 'preact';
    }

    // Detect bundler
    let bundler: ProjectContext['bundler'] = 'unknown';
    if (allDeps.includes('vite')) {
      bundler = 'vite';
    } else if (allDeps.includes('webpack')) {
      bundler = 'webpack';
    } else if (allDeps.includes('rollup')) {
      bundler = 'rollup';
    } else if (allDeps.includes('esbuild')) {
      bundler = 'esbuild';
    } else if (allDeps.includes('parcel')) {
      bundler = 'parcel';
    } else if (allDeps.includes('turbo')) {
      bundler = 'turbo';
    }

    // Check for TypeScript
    const hasTypeScript =
      allDeps.includes('typescript') ||
      fs.existsSync(path.join(projectPath, 'tsconfig.json'));

    // Check for SSR
    const hasSSR =
      allDeps.includes('next') ||
      allDeps.includes('nuxt') ||
      fs.existsSync(path.join(projectPath, 'server.js')) ||
      fs.existsSync(path.join(projectPath, 'server.ts'));

    // Count components
    const componentCount = await this.countComponents(projectPath, framework);

    // Estimate bundle size (rough)
    const averageBundleSize = await this.estimateBundleSize(projectPath);

    // Find config files
    const configFiles = this.findConfigFiles(projectPath);

    // Find entry points
    const entryPoints = this.findEntryPoints(projectPath);

    return {
      framework,
      bundler,
      hasSSR,
      hasTypeScript,
      componentCount,
      averageBundleSize,
      dependencies: dependencies.slice(0, 50),
      devDependencies: devDependencies.slice(0, 50),
      configFiles,
      entryPoints,
    };
  }

  private async countComponents(
    projectPath: string,
    framework: ProjectContext['framework'],
  ): Promise<number> {
    const extensions = this.getFrameworkExtensions(framework);
    let count = 0;

    const srcDirs = ['src', 'app', 'pages', 'components'];
    for (const dir of srcDirs) {
      const fullDir = path.join(projectPath, dir);
      if (fs.existsSync(fullDir)) {
        count += await this.countFilesWithExtensions(fullDir, extensions);
      }
    }

    return count;
  }

  private getFrameworkExtensions(
    framework: ProjectContext['framework'],
  ): string[] {
    switch (framework) {
      case 'react':
      case 'next':
      case 'preact':
        return ['.jsx', '.tsx', '.js', '.ts'];
      case 'vue':
      case 'nuxt':
        return ['.vue'];
      case 'angular':
        return ['.component.ts', '.component.html'];
      case 'svelte':
        return ['.svelte'];
      case 'solid':
        return ['.tsx', '.jsx'];
      default:
        return ['.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
    }
  }

  private async countFilesWithExtensions(
    dir: string,
    extensions: string[],
  ): Promise<number> {
    let count = 0;

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += await this.countFilesWithExtensions(fullPath, extensions);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          count++;
        }
      }
    } catch {
      // Directory not readable
    }

    return count;
  }

  private async estimateBundleSize(projectPath: string): Promise<number> {
    // Look for build output or estimate from source
    const distPaths = ['dist', 'build', '.next', '.nuxt', 'out'];
    let totalSize = 0;
    let fileCount = 0;

    for (const dist of distPaths) {
      const distPath = path.join(projectPath, dist);
      if (fs.existsSync(distPath)) {
        const size = await this.getDirectorySize(distPath);
        totalSize += size;
        fileCount++;
      }
    }

    return fileCount > 0 ? Math.round(totalSize / fileCount / 1024) : 0;
  }

  private async getDirectorySize(dir: string): Promise<number> {
    let size = 0;

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          size += await this.getDirectorySize(fullPath);
        } else {
          const stats = await stat(fullPath);
          size += stats.size;
        }
      }
    } catch {
      // Directory not readable
    }

    return size;
  }

  private findConfigFiles(projectPath: string): string[] {
    const configFiles = [
      'vite.config.ts',
      'vite.config.js',
      'webpack.config.js',
      'webpack.config.ts',
      'next.config.js',
      'next.config.ts',
      'nuxt.config.ts',
      'nuxt.config.js',
      'rollup.config.js',
      'tsconfig.json',
      'tailwind.config.js',
      'postcss.config.js',
      '.babelrc',
      'babel.config.js',
    ];

    const found: string[] = [];
    for (const config of configFiles) {
      if (fs.existsSync(path.join(projectPath, config))) {
        found.push(config);
      }
    }

    return found;
  }

  private findEntryPoints(projectPath: string): string[] {
    const possibleEntries = [
      'src/main.ts',
      'src/main.js',
      'src/index.ts',
      'src/index.js',
      'src/app.ts',
      'src/app.js',
      'pages/_app.tsx',
      'pages/_app.jsx',
      'app/layout.tsx',
      'app/layout.jsx',
      'index.html',
    ];

    const found: string[] = [];
    for (const entry of possibleEntries) {
      if (fs.existsSync(path.join(projectPath, entry))) {
        found.push(entry);
      }
    }

    return found;
  }

  private async findFilesBySelector(
    projectPath: string,
    selector: string,
  ): Promise<string[]> {
    const files: string[] = [];
    const normalizedSelector = selector.replace(/[#.\[\]]/g, ''); // eslint-disable-line no-useless-escape

    const searchDirs = ['src', 'app', 'components', 'pages', 'lib'];
    for (const dir of searchDirs) {
      const fullDir = path.join(projectPath, dir);
      if (fs.existsSync(fullDir)) {
        await this.searchFiles(fullDir, normalizedSelector, files);
      }
    }

    return files;
  }

  private async searchFiles(
    dir: string,
    pattern: string,
    results: string[],
  ): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.searchFiles(fullPath, pattern, results);
        } else if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory not readable
    }
  }

  private async findSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await this.findSourceFiles(fullPath)));
        } else if (/\.(ts|tsx|js|jsx|vue|svelte)$/i.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory not readable
    }

    return files;
  }
}
