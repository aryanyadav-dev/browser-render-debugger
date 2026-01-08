import { Module, OnModuleInit } from '@nestjs/common';
import { SuggesterService } from './suggester.service.js';
import { SpeedupCalculatorService } from './speedup-calculator.service.js';
import { CSSSuggester } from './css.suggester.js';
import { JSSuggester } from './js.suggester.js';
import { NativeSuggester } from './native.suggester.js';

@Module({
  providers: [
    SuggesterService,
    SpeedupCalculatorService,
    CSSSuggester,
    JSSuggester,
    NativeSuggester,
  ],
  exports: [
    SuggesterService,
    SpeedupCalculatorService,
    CSSSuggester,
    JSSuggester,
    NativeSuggester,
  ],
})
export class SuggesterModule implements OnModuleInit {
  constructor(
    private readonly suggesterService: SuggesterService,
    private readonly cssSuggester: CSSSuggester,
    private readonly jsSuggester: JSSuggester,
    private readonly nativeSuggester: NativeSuggester,
  ) {}

  /**
   * Register all suggesters on module initialization
   */
  onModuleInit(): void {
    this.suggesterService.registerSuggester(this.cssSuggester);
    this.suggesterService.registerSuggester(this.jsSuggester);
    this.suggesterService.registerSuggester(this.nativeSuggester);
  }
}
