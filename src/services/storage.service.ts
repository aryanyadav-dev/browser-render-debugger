import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  TraceData,
  TraceSummary,
  Config,
  RuleSet,
} from '../shared/types/index.js';

export interface StorageServiceOptions {
  baseDir?: string;
}

@Injectable()
export class StorageService {
  private readonly baseDir: string;
  private readonly tracesDir: string;
  private readonly reportsDir: string;
  private readonly patchesDir: string;
  private readonly backupsDir: string;
  private readonly scenariosDir: string;

  constructor(options: StorageServiceOptions = {}) {
    this.baseDir = options.baseDir ?? '.render-debugger';
    this.tracesDir = path.join(this.baseDir, 'traces');
    this.reportsDir = path.join(this.baseDir, 'reports');
    this.patchesDir = path.join(this.baseDir, 'patches');
    this.backupsDir = path.join(this.baseDir, 'patches', 'backups');
    this.scenariosDir = path.join(this.baseDir, 'scenarios');
  }

  /**
   * Ensure all required directories exist
   */
  async ensureDirectories(): Promise<void> {
    const dirs = [
      this.baseDir,
      this.tracesDir,
      this.reportsDir,
      this.patchesDir,
      this.backupsDir,
      this.scenariosDir,
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Write trace data to a run directory
   */
  async writeTrace(runId: string, trace: TraceData): Promise<string> {
    const runDir = path.join(this.tracesDir, runId);
    await fs.mkdir(runDir, { recursive: true });
    const tracePath = path.join(runDir, 'trace.json');
    await fs.writeFile(tracePath, JSON.stringify(trace, null, 2), 'utf-8');
    return tracePath;
  }

  /**
   * Write trace summary to a run directory
   */
  async writeSummary(runId: string, summary: TraceSummary): Promise<string> {
    const runDir = path.join(this.tracesDir, runId);
    await fs.mkdir(runDir, { recursive: true });
    const summaryPath = path.join(runDir, 'trace-summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return summaryPath;
  }

  /**
   * Write HTML report with timestamp
   */
  async writeReport(timestamp: string, html: string): Promise<string> {
    await fs.mkdir(this.reportsDir, { recursive: true });
    const reportPath = path.join(this.reportsDir, `report-${timestamp}.html`);
    await fs.writeFile(reportPath, html, 'utf-8');
    return reportPath;
  }

  /**
   * Write JSON report
   */
  async writeJsonReport(name: string, data: unknown): Promise<string> {
    await fs.mkdir(this.reportsDir, { recursive: true });
    const reportPath = path.join(this.reportsDir, `${name}.json`);
    await fs.writeFile(reportPath, JSON.stringify(data, null, 2), 'utf-8');
    return reportPath;
  }

  /**
   * Write patch file
   */
  async writePatch(name: string, patch: string): Promise<string> {
    await fs.mkdir(this.patchesDir, { recursive: true });
    const patchPath = path.join(this.patchesDir, `${name}.patch`);
    await fs.writeFile(patchPath, patch, 'utf-8');
    return patchPath;
  }

  /**
   * Write backup of original file
   */
  async writeBackup(filePath: string, content: string): Promise<string> {
    await fs.mkdir(this.backupsDir, { recursive: true });
    const backupName = filePath.replace(/[/\\]/g, '_');
    const backupPath = path.join(this.backupsDir, backupName);
    await fs.writeFile(backupPath, content, 'utf-8');
    return backupPath;
  }

  /**
   * Read configuration file
   */
  async readConfig(): Promise<Config | null> {
    const configPath = path.join(this.baseDir, 'config.yaml');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return yaml.load(content) as Config;
    } catch {
      return null;
    }
  }

  /**
   * Write configuration file
   */
  async writeConfig(config: Config): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const configPath = path.join(this.baseDir, 'config.yaml');
    const content = yaml.dump(config, { indent: 2, lineWidth: 120 });
    await fs.writeFile(configPath, content, 'utf-8');
  }

  /**
   * Read rules file
   */
  async readRules(): Promise<RuleSet | null> {
    const rulesPath = path.join(this.baseDir, 'rules.yaml');
    try {
      const content = await fs.readFile(rulesPath, 'utf-8');
      return yaml.load(content) as RuleSet;
    } catch {
      return null;
    }
  }

  /**
   * Write rules file
   */
  async writeRules(rules: RuleSet): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const rulesPath = path.join(this.baseDir, 'rules.yaml');
    const content = yaml.dump(rules, { indent: 2, lineWidth: 120 });
    await fs.writeFile(rulesPath, content, 'utf-8');
  }

  /**
   * Write scenario file
   */
  async writeScenario(name: string, content: string): Promise<string> {
    await fs.mkdir(this.scenariosDir, { recursive: true });
    const scenarioPath = path.join(this.scenariosDir, `${name}.yaml`);
    await fs.writeFile(scenarioPath, content, 'utf-8');
    return scenarioPath;
  }

  /**
   * Read trace data from file
   */
  async readTrace(tracePath: string): Promise<TraceData> {
    const content = await fs.readFile(tracePath, 'utf-8');
    return JSON.parse(content) as TraceData;
  }

  /**
   * Check if a file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the base directory path
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Get the traces directory path
   */
  getTracesDir(): string {
    return this.tracesDir;
  }

  /**
   * Get the reports directory path
   */
  getReportsDir(): string {
    return this.reportsDir;
  }

  /**
   * Get the patches directory path
   */
  getPatchesDir(): string {
    return this.patchesDir;
  }

  /**
   * Get the backups directory path
   */
  getBackupsDir(): string {
    return this.backupsDir;
  }

  /**
   * Get the scenarios directory path
   */
  getScenariosDir(): string {
    return this.scenariosDir;
  }

  /**
   * Find the most recent trace file
   * Searches in traces directory for the latest trace.json
   */
  async findLatestTrace(): Promise<string | null> {
    try {
      const entries = await fs.readdir(this.tracesDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      if (dirs.length === 0) {
        // Check for direct trace files
        const files = entries.filter(
          (e) => e.isFile() && e.name.endsWith('.json'),
        );
        if (files.length > 0) {
          // Sort by modification time
          const fileStats = await Promise.all(
            files.map(async (f) => {
              const filePath = path.join(this.tracesDir, f.name);
              const stat = await fs.stat(filePath);
              return { path: filePath, mtime: stat.mtime };
            }),
          );
          fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
          return fileStats[0].path;
        }
        return null;
      }

      // Get stats for all directories to find most recent
      const dirStats = await Promise.all(
        dirs.map(async (d) => {
          const dirPath = path.join(this.tracesDir, d.name);
          const stat = await fs.stat(dirPath);
          return { name: d.name, path: dirPath, mtime: stat.mtime };
        }),
      );

      // Sort by modification time (newest first)
      dirStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Look for trace.json in the most recent directory
      for (const dir of dirStats) {
        const tracePath = path.join(dir.path, 'trace.json');
        if (await this.exists(tracePath)) {
          return tracePath;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * List all available traces with metadata
   */
  async listTraces(): Promise<
    Array<{ name: string; path: string; date: Date }>
  > {
    try {
      const traces: Array<{ name: string; path: string; date: Date }> = [];
      const entries = await fs.readdir(this.tracesDir, { withFileTypes: true });

      // Check directories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const tracePath = path.join(this.tracesDir, entry.name, 'trace.json');
          if (await this.exists(tracePath)) {
            const stat = await fs.stat(tracePath);
            traces.push({
              name: entry.name,
              path: tracePath,
              date: stat.mtime,
            });
          }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          const tracePath = path.join(this.tracesDir, entry.name);
          const stat = await fs.stat(tracePath);
          traces.push({
            name: entry.name.replace('.json', ''),
            path: tracePath,
            date: stat.mtime,
          });
        }
      }

      // Sort by date (newest first)
      traces.sort((a, b) => b.date.getTime() - a.date.getTime());
      return traces;
    } catch {
      return [];
    }
  }
}
