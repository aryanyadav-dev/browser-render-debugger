/**
 * Tracing interfaces for CDP Tracing domain
 */

import type {
  TraceEvent,
  TraceMetadata,
  TraceData,
} from '../../shared/types/index.js';

export interface TracingOptions {
  categories: string[];
  bufferUsageReportingInterval?: number;
  transferMode?: 'ReportEvents' | 'ReturnAsStream';
}

export interface ITracingService {
  startTracing(options: TracingOptions): Promise<void>;
  stopTracing(): Promise<TraceData>;
  isTracing(): boolean;
  getCategories(): string[];
}

export interface TracingStartParams {
  categories?: string;
  options?: string;
  bufferUsageReportingInterval?: number;
  transferMode?: 'ReportEvents' | 'ReturnAsStream';
  traceConfig?: {
    recordMode?:
      | 'recordUntilFull'
      | 'recordContinuously'
      | 'recordAsMuchAsPossible';
    enableSampling?: boolean;
    enableSystrace?: boolean;
    enableArgumentFilter?: boolean;
    includedCategories?: string[];
    excludedCategories?: string[];
    memoryDumpConfig?: Record<string, unknown>;
  };
}

export { TraceEvent, TraceMetadata, TraceData };
