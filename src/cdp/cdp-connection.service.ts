import { Injectable } from '@nestjs/common';
import CDP from 'chrome-remote-interface';
import { spawn, ChildProcess } from 'child_process';
import type {
  ICDPConnection,
  CDPConnectionOptions,
  CDPSession,
  BrowserInfo,
} from './interfaces/index.js';
import {
  CDPConnectionError,
  BrowserLaunchError,
} from '../errors/error-types.js';

const DEFAULT_CDP_PORT = 9222;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface CDPClient {
  send(method: string, params?: object): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
  close(): Promise<void>;
  Browser: {
    getVersion(): Promise<{
      protocolVersion: string;
      product: string;
      revision: string;
      userAgent: string;
      jsVersion: string;
    }>;
  };
  Page: {
    enable(): Promise<void>;
    navigate(params: {
      url: string;
    }): Promise<{ frameId: string; loaderId?: string }>;
    loadEventFired(): Promise<void>;
  };
  Runtime: {
    enable(): Promise<void>;
    evaluate(params: {
      expression: string;
      awaitPromise?: boolean;
    }): Promise<unknown>;
  };
  Tracing: {
    start(params: object): Promise<void>;
    end(): Promise<void>;
    dataCollected(handler: (params: { value: unknown[] }) => void): void;
    tracingComplete(handler: () => void): void;
  };
}

@Injectable()
export class CDPConnectionService implements ICDPConnection {
  private client: CDPClient | null = null;
  private browserProcess: ChildProcess | null = null;
  private connected = false;
  private browserInfo: BrowserInfo | null = null;

  /**
   * Connect to a browser via CDP
   */
  async connect(options: CDPConnectionOptions): Promise<CDPSession> {
    const port = options.cdpPort ?? DEFAULT_CDP_PORT;

    // If browser path is provided, launch the browser
    if (options.browserPath) {
      await this.launchBrowser(
        options.browserPath,
        port,
        options.headless ?? true,
      );
    }

    // Connect to CDP with retry logic
    this.client = await this.connectWithRetry(port);
    this.connected = true;

    // Get browser info
    await this.fetchBrowserInfo();

    return this.createSession();
  }

  /**
   * Disconnect from the browser
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
    }

    if (this.browserProcess) {
      this.browserProcess.kill('SIGTERM');
      this.browserProcess = null;
    }

    this.connected = false;
    this.browserInfo = null;
  }

  /**
   * Check if connected to browser
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Get the current CDP session
   */
  getSession(): CDPSession | null {
    if (!this.client) return null;
    return this.createSession();
  }

  /**
   * Get browser information
   */
  getBrowserInfo(): BrowserInfo | null {
    return this.browserInfo;
  }

  /**
   * Get the raw CDP client for advanced operations
   */
  getClient(): CDPClient | null {
    return this.client;
  }

  /**
   * Launch browser with remote debugging enabled
   */
  private async launchBrowser(
    browserPath: string,
    port: number,
    headless: boolean,
  ): Promise<void> {
    const args = [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
    ];

    if (headless) {
      args.push('--headless=new');
    }

    try {
      this.browserProcess = spawn(browserPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Wait for browser to start
      await this.waitForBrowserReady(port);
    } catch (error) {
      throw new BrowserLaunchError(
        browserPath,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Wait for browser to be ready for CDP connections
   */
  private async waitForBrowserReady(port: number): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const targets = await CDP.List({ port });
        if (targets && targets.length > 0) {
          return;
        }
      } catch {
        // Browser not ready yet
      }
      await this.delay(delayMs);
    }

    throw new BrowserLaunchError(
      'unknown',
      new Error('Browser did not become ready in time'),
    );
  }

  /**
   * Connect to CDP with retry logic
   */
  private async connectWithRetry(port: number): Promise<CDPClient> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const client = await CDP({
          port,
        });
        return client as unknown as CDPClient;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw new CDPConnectionError('localhost', port, lastError);
  }

  /**
   * Fetch browser version information
   */
  private async fetchBrowserInfo(): Promise<void> {
    if (!this.client) return;

    try {
      const version = await this.client.Browser.getVersion();
      this.browserInfo = {
        browserVersion: version.product,
        userAgent: version.userAgent,
      };
    } catch {
      // Browser info is optional
      this.browserInfo = {
        browserVersion: 'unknown',
        userAgent: 'unknown',
      };
    }
  }

  /**
   * Create a CDPSession wrapper around the client
   */
  private createSession(): CDPSession {
    const client = this.client!;

    return {
      send: async <T>(method: string, params?: object): Promise<T> => {
        return client.send(method, params) as Promise<T>;
      },
      on: (event: string, handler: (params: unknown) => void): void => {
        client.on(event, handler);
      },
      off: (event: string, handler: (params: unknown) => void): void => {
        client.off(event, handler);
      },
      close: async (): Promise<void> => {
        await client.close();
      },
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
