import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { ConfigService } from './config.service.js';
import { BrowserValidationService } from './browser-validation.service.js';
import { SourceMapService } from './sourcemap.service.js';
import { TraceLifecycleService } from './trace-lifecycle.service.js';
import { SamplingService } from './sampling.service.js';
import { PrivacyService } from './privacy.service.js';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: () => new StorageService(),
    },
    ConfigService,
    BrowserValidationService,
    SourceMapService,
    TraceLifecycleService,
    SamplingService,
    PrivacyService,
  ],
  exports: [
    StorageService,
    ConfigService,
    BrowserValidationService,
    SourceMapService,
    TraceLifecycleService,
    SamplingService,
    PrivacyService,
  ],
})
export class ServicesModule {}
