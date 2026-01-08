/**
 * Patcher Service
 * Main service for patch generation and application
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 15.22
 */

import { Injectable } from '@nestjs/common';
import type { Suggestion } from '../shared/types/suggestion.types.js';
import type {
  Patch,
  ApplyOptions,
  ApplyResult,
  DryRunResult,
} from '../shared/types/patch.types.js';
import type { IPatcherService } from './interfaces/index.js';
import { PatchGeneratorService } from './patch-generator.service.js';
import { DryRunService } from './dry-run.service.js';
import { AutoApplyService } from './auto-apply.service.js';
import {
  FixTargetFilterService,
  type FilteredSuggestions,
} from './fix-target-filter.service.js';

@Injectable()
export class PatcherService implements IPatcherService {
  constructor(
    private readonly patchGenerator: PatchGeneratorService,
    private readonly dryRunService: DryRunService,
    private readonly autoApplyService: AutoApplyService,
    private readonly fixTargetFilter: FixTargetFilterService,
  ) {}

  /**
   * Generate patches from suggestions
   * Only generates patches for patchable suggestions (JS/CSS)
   * Native code suggestions are filtered out
   */
  async generatePatches(suggestions: Suggestion[]): Promise<Patch[]> {
    // Filter to only patchable suggestions (JS/CSS)
    const patchableSuggestions =
      this.fixTargetFilter.getPatchableSuggestions(suggestions);

    return this.patchGenerator.generatePatches(patchableSuggestions);
  }

  /**
   * Apply patches with options
   */
  async applyPatches(
    patches: Patch[],
    options: ApplyOptions,
  ): Promise<ApplyResult> {
    return this.autoApplyService.apply(patches, options);
  }

  /**
   * Dry run - write patches without applying
   */
  async dryRun(patches: Patch[]): Promise<DryRunResult> {
    return this.dryRunService.preview(patches);
  }

  /**
   * Filter suggestions by fix target type
   * Returns categorized suggestions: patchable vs suggestion-only
   */
  filterSuggestionsByFixTarget(suggestions: Suggestion[]): FilteredSuggestions {
    return this.fixTargetFilter.filterSuggestions(suggestions);
  }

  /**
   * Check if a suggestion can be auto-patched
   */
  isSuggestionPatchable(suggestion: Suggestion): boolean {
    return this.fixTargetFilter.isPatchable(suggestion);
  }
}
