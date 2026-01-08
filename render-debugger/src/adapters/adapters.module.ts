/**
 * Adapters Module
 *
 * Provides browser adapter infrastructure for multi-platform trace collection.
 * Supports Chromium CDP, WebKit native, and other browser platforms.
 */

import { Module, OnModuleInit } from '@nestjs/common';
import { AdapterRegistryService } from './adapter-registry.service.js';
import {
  ChromiumCDPAdapter,
  createChromiumCDPAdapter,
} from './chromium-cdp/index.js';
import {
  WebKitNativeAdapter,
  createWebKitNativeAdapter,
} from './webkit-native/index.js';

@Module({
  providers: [AdapterRegistryService],
  exports: [AdapterRegistryService],
})
export class AdaptersModule implements OnModuleInit {
  constructor(private readonly adapterRegistry: AdapterRegistryService) {}

  /**
   * Register built-in adapters on module initialization
   */
  onModuleInit(): void {
    // Register Chromium CDP adapter
    const chromiumAdapter = new ChromiumCDPAdapter();
    this.adapterRegistry.registerAdapter({
      metadata: chromiumAdapter.metadata,
      factory: createChromiumCDPAdapter,
    });

    // Register WebKit Native adapter
    const webkitAdapter = new WebKitNativeAdapter();
    this.adapterRegistry.registerAdapter({
      metadata: webkitAdapter.metadata,
      factory: createWebKitNativeAdapter,
    });
  }
}
