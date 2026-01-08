/**
 * CSS Suggester
 * Generates CSS-based fix suggestions for layout and paint issues
 *
 * Requirements: 10.8, 10.9
 * - Produces safe suggestions including contain, will-change, and transforms
 * - Warns on memory/cost tradeoffs for suggestions
 */

import { Injectable } from '@nestjs/common';
import type {
  Detection,
  DetectionType,
  LayoutThrashDetection,
  GPUStallDetection,
  HeavyPaintDetection,
} from '../shared/types/index.js';
import type { CSSSuggestion } from '../shared/types/suggestion.types.js';
import type { ISuggester } from './interfaces/index.js';
import { SpeedupCalculatorService } from './speedup-calculator.service.js';
import { SuggesterService } from './suggester.service.js';

/**
 * CSS property suggestions with their tradeoffs
 */
interface CSSPropertySuggestion {
  property: string;
  value: string;
  memoryImpact: 'none' | 'low' | 'medium' | 'high';
  tradeoffs: string[];
  description: string;
}

/**
 * Safe CSS properties for performance optimization
 */
const CSS_SUGGESTIONS: Record<string, CSSPropertySuggestion> = {
  contain_strict: {
    property: 'contain',
    value: 'strict',
    memoryImpact: 'low',
    tradeoffs: [
      'Element becomes a containing block for positioned descendants',
      'Overflow is clipped',
      'Element establishes independent formatting context',
    ],
    description:
      'Apply strict containment to isolate layout, paint, and style calculations',
  },
  contain_layout: {
    property: 'contain',
    value: 'layout',
    memoryImpact: 'none',
    tradeoffs: [
      'Element becomes a containing block for positioned descendants',
      'Layout changes inside do not affect outside elements',
    ],
    description:
      'Apply layout containment to prevent layout thrashing from propagating',
  },
  contain_paint: {
    property: 'contain',
    value: 'paint',
    memoryImpact: 'low',
    tradeoffs: [
      'Descendants are clipped to element bounds',
      'Creates a new stacking context',
    ],
    description:
      'Apply paint containment to limit repaint scope to this element',
  },
  contain_content: {
    property: 'contain',
    value: 'content',
    memoryImpact: 'low',
    tradeoffs: [
      'Combines layout and paint containment',
      'Element size must not depend on descendants',
    ],
    description:
      'Apply content containment for general performance improvement',
  },
  will_change_transform: {
    property: 'will-change',
    value: 'transform',
    memoryImpact: 'medium',
    tradeoffs: [
      'Creates a new compositor layer (GPU memory)',
      'Should be removed when animation completes',
      'Overuse can cause memory issues',
    ],
    description:
      'Hint to browser that transform will change, promoting to compositor layer',
  },
  will_change_opacity: {
    property: 'will-change',
    value: 'opacity',
    memoryImpact: 'medium',
    tradeoffs: [
      'Creates a new compositor layer (GPU memory)',
      'Should be removed when animation completes',
    ],
    description:
      'Hint to browser that opacity will change, enabling GPU acceleration',
  },
  transform_translate: {
    property: 'transform',
    value: 'translateZ(0)',
    memoryImpact: 'medium',
    tradeoffs: [
      'Forces GPU layer creation',
      'May cause blurry text on some browsers',
      'Increases GPU memory usage',
    ],
    description:
      'Force GPU acceleration by creating a 3D transform context (legacy approach)',
  },
  transform_3d: {
    property: 'transform-style',
    value: 'preserve-3d',
    memoryImpact: 'high',
    tradeoffs: [
      'Creates 3D rendering context',
      'Significant GPU memory overhead',
      'May cause z-index issues',
    ],
    description: 'Enable 3D transforms for complex animations',
  },
  backface_hidden: {
    property: 'backface-visibility',
    value: 'hidden',
    memoryImpact: 'low',
    tradeoffs: [
      'Back of element not rendered during 3D transforms',
      'Can improve performance for flipping animations',
    ],
    description: 'Hide backface to reduce rendering work during 3D transforms',
  },
  isolation_isolate: {
    property: 'isolation',
    value: 'isolate',
    memoryImpact: 'low',
    tradeoffs: [
      'Creates new stacking context',
      'Affects z-index behavior of descendants',
    ],
    description:
      'Create isolated stacking context to limit blend mode calculations',
  },
};

/**
 * Frame budget for 60fps (default)
 */
const DEFAULT_FRAME_BUDGET_MS = 16.67;

@Injectable()
export class CSSSuggester implements ISuggester {
  readonly name = 'CSSSuggester';
  readonly supportedTypes: DetectionType[] = [
    'layout_thrashing',
    'gpu_stall',
    'heavy_paint',
    'forced_reflow',
  ];

  constructor(private readonly speedupCalculator: SpeedupCalculatorService) {}

  /**
   * Generate CSS suggestion for a detection
   */
  suggest(detection: Detection): Promise<CSSSuggestion | null> {
    switch (detection.type) {
      case 'layout_thrashing':
        return Promise.resolve(
          this.suggestForLayoutThrashing(detection as LayoutThrashDetection),
        );
      case 'gpu_stall':
        return Promise.resolve(
          this.suggestForGPUStall(detection as GPUStallDetection),
        );
      case 'heavy_paint':
        return Promise.resolve(
          this.suggestForHeavyPaint(detection as HeavyPaintDetection),
        );
      case 'forced_reflow':
        return Promise.resolve(this.suggestForForcedReflow(detection));
      default:
        return Promise.resolve(null);
    }
  }

  /**
   * Generate suggestion for layout thrashing
   */
  private suggestForLayoutThrashing(
    detection: LayoutThrashDetection,
  ): CSSSuggestion {
    const selector = detection.selector || 'element';
    const cssSuggestion = CSS_SUGGESTIONS.contain_layout!;

    const originalRule = `${selector} {\n  /* No containment */\n}`;
    const suggestedRule = `${selector} {\n  contain: layout;\n}`;

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.reflowCostMs,
      DEFAULT_FRAME_BUDGET_MS,
      'contain_property',
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      'contain_property',
      'layout_thrashing',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'css',
      target: selector,
      description: `Apply CSS containment to "${selector}" to prevent layout thrashing. ${cssSuggestion.description}`,
      patch: this.generatePatch(selector, cssSuggestion),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(cssSuggestion),
      affectedFiles: [],
      originalRule,
      suggestedRule,
      property: cssSuggestion.property,
      memoryImpact: cssSuggestion.memoryImpact,
      tradeoffs: cssSuggestion.tradeoffs,
    };
  }

  /**
   * Generate suggestion for GPU stall
   */
  private suggestForGPUStall(detection: GPUStallDetection): CSSSuggestion {
    const element = detection.element || 'element';

    // Choose suggestion based on stall type
    let cssSuggestion: CSSPropertySuggestion;
    let fixType: string;

    if (detection.stallType === 'texture_upload') {
      cssSuggestion = CSS_SUGGESTIONS.will_change_transform!;
      fixType = 'will_change';
    } else if (detection.stallType === 'raster') {
      cssSuggestion = CSS_SUGGESTIONS.contain_paint!;
      fixType = 'contain_property';
    } else {
      // sync stall - use will-change for layer promotion
      cssSuggestion = CSS_SUGGESTIONS.will_change_transform!;
      fixType = 'will_change';
    }

    const originalRule = `${element} {\n  /* No GPU optimization */\n}`;
    const suggestedRule = `${element} {\n  ${cssSuggestion.property}: ${cssSuggestion.value};\n}`;

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.stallMs,
      DEFAULT_FRAME_BUDGET_MS,
      fixType,
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      fixType,
      'gpu_stall',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'css',
      target: element,
      description: `Apply ${cssSuggestion.property} to "${element}" to reduce GPU stalls. ${cssSuggestion.description}`,
      patch: this.generatePatch(element, cssSuggestion),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(cssSuggestion),
      affectedFiles: [],
      originalRule,
      suggestedRule,
      property: cssSuggestion.property,
      memoryImpact: cssSuggestion.memoryImpact,
      tradeoffs: cssSuggestion.tradeoffs,
    };
  }

  /**
   * Generate suggestion for heavy paint
   */
  private suggestForHeavyPaint(detection: HeavyPaintDetection): CSSSuggestion {
    const selector = detection.location.selector || 'element';
    const cssSuggestion = CSS_SUGGESTIONS.contain_paint!;

    const originalRule = `${selector} {\n  /* No paint containment */\n}`;
    const suggestedRule = `${selector} {\n  contain: paint;\n}`;

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.paintTimeMs,
      DEFAULT_FRAME_BUDGET_MS,
      'contain_property',
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      'contain_property',
      'heavy_paint',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'css',
      target: selector,
      description: `Apply paint containment to "${selector}" to limit repaint scope. ${cssSuggestion.description}`,
      patch: this.generatePatch(selector, cssSuggestion),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(cssSuggestion),
      affectedFiles: [],
      originalRule,
      suggestedRule,
      property: cssSuggestion.property,
      memoryImpact: cssSuggestion.memoryImpact,
      tradeoffs: cssSuggestion.tradeoffs,
    };
  }

  /**
   * Generate suggestion for forced reflow
   */
  private suggestForForcedReflow(detection: Detection): CSSSuggestion {
    const selector = detection.location.selector || 'element';
    const cssSuggestion = CSS_SUGGESTIONS.contain_strict!;

    const originalRule = `${selector} {\n  /* No containment */\n}`;
    const suggestedRule = `${selector} {\n  contain: strict;\n}`;

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.metrics.durationMs,
      DEFAULT_FRAME_BUDGET_MS,
      'contain_property',
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      'contain_property',
      'forced_reflow',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'css',
      target: selector,
      description: `Apply strict containment to "${selector}" to isolate forced reflows. ${cssSuggestion.description}`,
      patch: this.generatePatch(selector, cssSuggestion),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(cssSuggestion),
      affectedFiles: [],
      originalRule,
      suggestedRule,
      property: cssSuggestion.property,
      memoryImpact: cssSuggestion.memoryImpact,
      tradeoffs: cssSuggestion.tradeoffs,
    };
  }

  /**
   * Generate CSS patch content
   */
  private generatePatch(
    selector: string,
    suggestion: CSSPropertySuggestion,
  ): string {
    return `/* Performance optimization for ${selector} */\n${selector} {\n  ${suggestion.property}: ${suggestion.value};\n}`;
  }

  /**
   * Generate warnings based on suggestion and detection
   */
  private generateWarnings(suggestion: CSSPropertySuggestion): string[] {
    const warnings: string[] = [];

    // Memory impact warning
    if (suggestion.memoryImpact === 'high') {
      warnings.push(
        '⚠️ HIGH MEMORY IMPACT: This suggestion significantly increases GPU memory usage. Monitor memory consumption after applying.',
      );
    } else if (suggestion.memoryImpact === 'medium') {
      warnings.push(
        '⚠️ MODERATE MEMORY IMPACT: This suggestion creates additional compositor layers. Consider removing when not needed.',
      );
    }

    // will-change specific warnings
    if (suggestion.property === 'will-change') {
      warnings.push(
        '⚠️ WILL-CHANGE USAGE: Apply will-change only when needed and remove after animations complete to free GPU memory.',
      );
    }

    // Containment warnings
    if (suggestion.property === 'contain') {
      if (
        suggestion.value === 'strict' ||
        suggestion.value === 'paint' ||
        suggestion.value === 'content'
      ) {
        warnings.push(
          '⚠️ OVERFLOW CLIPPING: Content outside element bounds will be clipped. Ensure this is acceptable for your layout.',
        );
      }
      if (suggestion.value === 'strict' || suggestion.value === 'size') {
        warnings.push(
          '⚠️ SIZE CONTAINMENT: Element size must be explicitly set and cannot depend on descendants.',
        );
      }
    }

    // Add tradeoffs as warnings
    for (const tradeoff of suggestion.tradeoffs) {
      warnings.push(`ℹ️ TRADEOFF: ${tradeoff}`);
    }

    return warnings;
  }
}
