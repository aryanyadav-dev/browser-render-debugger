/**
 * CDP Connection interfaces for Chrome DevTools Protocol communication
 */

export interface CDPConnectionOptions {
  browserPath?: string;
  cdpPort?: number;
  headless?: boolean;
  timeout?: number;
}

export interface CDPSession {
  send<T>(method: string, params?: object): Promise<T>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
  close(): Promise<void>;
}

export interface ICDPConnection {
  connect(options: CDPConnectionOptions): Promise<CDPSession>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getSession(): CDPSession | null;
}

export interface BrowserInfo {
  browserVersion: string;
  userAgent: string;
  webSocketDebuggerUrl?: string;
}
