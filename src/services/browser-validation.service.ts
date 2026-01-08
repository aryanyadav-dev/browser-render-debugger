import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { BrowserValidationError } from '../errors/error-types.js';

const execAsync = promisify(exec);

export interface BrowserValidationResult {
  valid: boolean;
  browserPath: string;
  browserName?: string;
  version?: string;
  error?: string;
}

/**
 * Service for validating Chromium-based browser binaries
 */
@Injectable()
export class BrowserValidationService {
  /**
   * Known Chromium-based browser identifiers in version output
   */
  private readonly chromiumIdentifiers = [
    'chromium',
    'chrome',
    'google chrome',
    'microsoft edge',
    'brave',
    'opera',
    'vivaldi',
    'arc',
    'dia',
    'zen',
  ];

  /**
   * Validate that a path points to a valid Chromium-based browser
   * @param browserPath Path to the browser executable
   * @returns Validation result with browser info
   * @throws BrowserValidationError if validation fails
   */
  async validateBrowser(browserPath: string): Promise<BrowserValidationResult> {
    // Check if file exists
    const exists = await this.fileExists(browserPath);
    if (!exists) {
      throw new BrowserValidationError(browserPath, 'File does not exist');
    }

    // Check if file is executable
    const isExecutable = await this.isExecutable(browserPath);
    if (!isExecutable) {
      throw new BrowserValidationError(browserPath, 'File is not executable');
    }

    // Execute with --version flag to get browser info
    const versionInfo = await this.getVersionInfo(browserPath);
    if (!versionInfo) {
      throw new BrowserValidationError(
        browserPath,
        'Failed to get version information from browser',
      );
    }

    // Check if it's a Chromium-based browser
    const isChromium = this.isChromiumBased(versionInfo);
    if (!isChromium) {
      throw new BrowserValidationError(
        browserPath,
        `Not a Chromium-based browser. Version output: ${versionInfo}`,
      );
    }

    // Parse browser name and version
    const { name, version } = this.parseVersionInfo(versionInfo);

    return {
      valid: true,
      browserPath,
      browserName: name,
      version,
    };
  }

  /**
   * Check if a file exists at the given path
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
   * Check if a file is executable
   */
  private async isExecutable(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute browser with --version flag and capture output
   */
  private async getVersionInfo(browserPath: string): Promise<string | null> {
    try {
      const { stdout, stderr } = await execAsync(`"${browserPath}" --version`, {
        timeout: 10000, // 10 second timeout
      });
      // Some browsers output to stderr
      return (stdout || stderr).trim();
    } catch {
      // Try alternative approach for macOS .app bundles
      if (browserPath.endsWith('.app')) {
        return this.getVersionInfoFromApp(browserPath);
      }
      return null;
    }
  }

  /**
   * Get version info from macOS .app bundle
   */
  private async getVersionInfoFromApp(appPath: string): Promise<string | null> {
    try {
      // Try to find the actual executable inside the .app bundle
      const executablePath = `${appPath}/Contents/MacOS`;
      const files = await fs.readdir(executablePath);

      if (files.length > 0) {
        const mainExecutable = `${executablePath}/${files[0]}`;
        const { stdout, stderr } = await execAsync(
          `"${mainExecutable}" --version`,
          {
            timeout: 10000,
          },
        );
        return (stdout || stderr).trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if version output indicates a Chromium-based browser
   */
  private isChromiumBased(versionOutput: string): boolean {
    const lowerOutput = versionOutput.toLowerCase();
    return this.chromiumIdentifiers.some((identifier) =>
      lowerOutput.includes(identifier),
    );
  }

  /**
   * Parse browser name and version from version output
   */
  private parseVersionInfo(versionOutput: string): {
    name: string;
    version: string;
  } {
    // Common patterns:
    // "Google Chrome 120.0.6099.109"
    // "Chromium 120.0.6099.109"
    // "Microsoft Edge 120.0.2210.91"
    // "Brave Browser 1.61.109 Chromium: 120.0.6099.109"

    const lines = versionOutput.split('\n');
    const firstLine = (lines[0] ?? '').trim();

    // Try to extract version number (pattern: X.X.X.X or X.X.X)
    const versionMatch = firstLine.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
    const version = versionMatch?.[1] ?? 'unknown';

    // Extract browser name (everything before the version number)
    let name = 'Chromium';
    if (versionMatch?.index !== undefined) {
      const beforeVersion = firstLine.substring(0, versionMatch.index).trim();
      if (beforeVersion) {
        name = beforeVersion;
      }
    } else {
      // If no version found, use the whole first line as name
      name = firstLine || 'Chromium';
    }

    return { name, version };
  }
}
