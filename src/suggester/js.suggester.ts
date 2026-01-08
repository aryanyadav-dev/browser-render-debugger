/**
 * JS Suggester
 * Generates JavaScript-based fix suggestions for long task issues
 *
 * Requirements: 10.10, 10.11, 10.12, 10.13
 * - Recommends batching DOM writes
 * - Recommends debounce patterns
 * - Recommends moving work to Web Workers
 * - Recommends offloading to requestAnimationFrame
 */

import { Injectable } from '@nestjs/common';
import type {
  Detection,
  DetectionType,
  LongTaskDetection,
  LayoutThrashDetection,
} from '../shared/types/index.js';
import type {
  JSSuggestion,
  JSFixPattern,
} from '../shared/types/suggestion.types.js';
import type { ISuggester } from './interfaces/index.js';
import { SpeedupCalculatorService } from './speedup-calculator.service.js';
import { SuggesterService } from './suggester.service.js';

/**
 * JS pattern suggestions with code templates
 */
interface JSPatternSuggestion {
  pattern: JSFixPattern;
  description: string;
  codeTemplate: string;
  suggestedTemplate: string;
  applicableTo: DetectionType[];
  warnings: string[];
}

/**
 * JS fix patterns with templates
 */
const JS_PATTERNS: Record<JSFixPattern, JSPatternSuggestion> = {
  batch_dom_writes: {
    pattern: 'batch_dom_writes',
    description:
      'Batch DOM reads and writes to avoid forced synchronous layouts',
    codeTemplate: `// Current: Interleaved reads and writes
elements.forEach(el => {
  const width = el.offsetWidth; // Read (forces layout)
  el.style.width = width + 10 + 'px'; // Write
});`,
    suggestedTemplate: `// Optimized: Batch reads, then batch writes
const widths = elements.map(el => el.offsetWidth); // All reads first
elements.forEach((el, i) => {
  el.style.width = widths[i] + 10 + 'px'; // All writes after
});`,
    applicableTo: ['layout_thrashing', 'forced_reflow'],
    warnings: [
      'Ensure all reads complete before any writes begin',
      'Consider using requestAnimationFrame for visual updates',
    ],
  },
  debounce: {
    pattern: 'debounce',
    description: 'Debounce rapid event handlers to reduce execution frequency',
    codeTemplate: `// Current: Handler runs on every event
window.addEventListener('scroll', () => {
  updateLayout(); // Runs 60+ times per second
});`,
    suggestedTemplate: `// Optimized: Debounced handler
function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

window.addEventListener('scroll', debounce(() => {
  updateLayout();
}, 100)); // Runs at most every 100ms`,
    applicableTo: ['long_task', 'layout_thrashing'],
    warnings: [
      'Debouncing adds latency to user interactions',
      'Choose delay based on acceptable responsiveness',
      'Consider throttle for continuous updates instead',
    ],
  },
  move_to_worker: {
    pattern: 'move_to_worker',
    description:
      'Move heavy computation to a Web Worker to avoid blocking the main thread',
    codeTemplate: `// Current: Heavy computation on main thread
function processData(data) {
  // CPU-intensive work blocks UI
  return heavyComputation(data);
}`,
    suggestedTemplate: `// Optimized: Offload to Web Worker
// worker.js
self.onmessage = (e) => {
  const result = heavyComputation(e.data);
  self.postMessage(result);
};

// main.js
const worker = new Worker('worker.js');
worker.postMessage(data);
worker.onmessage = (e) => {
  handleResult(e.data);
};`,
    applicableTo: ['long_task'],
    warnings: [
      'Web Workers cannot access DOM directly',
      'Data transfer has serialization overhead',
      'Consider SharedArrayBuffer for large data',
      'Workers add complexity to error handling',
    ],
  },
  use_raf: {
    pattern: 'use_raf',
    description:
      'Use requestAnimationFrame to schedule visual updates efficiently',
    codeTemplate: `// Current: Updates may cause layout thrashing
function updateUI() {
  element.style.transform = 'translateX(' + x + 'px)';
  // May run multiple times per frame
}`,
    suggestedTemplate: `// Optimized: Schedule with requestAnimationFrame
let rafId = null;
let pendingUpdate = false;

function scheduleUpdate() {
  if (pendingUpdate) return;
  pendingUpdate = true;
  
  rafId = requestAnimationFrame(() => {
    element.style.transform = 'translateX(' + x + 'px)';
    pendingUpdate = false;
  });
}

// Call scheduleUpdate() instead of updateUI()`,
    applicableTo: ['long_task', 'layout_thrashing', 'forced_reflow'],
    warnings: [
      'RAF callbacks run before paint, not after',
      'Cancel pending RAF on cleanup to prevent memory leaks',
      'Avoid heavy computation inside RAF callback',
    ],
  },
  use_css_animation: {
    pattern: 'use_css_animation',
    description:
      'Replace JavaScript animations with CSS animations for GPU acceleration',
    codeTemplate: `// Current: JavaScript-driven animation
function animate() {
  element.style.left = x + 'px';
  x += 1;
  requestAnimationFrame(animate);
}`,
    suggestedTemplate: `// Optimized: CSS animation with GPU acceleration
/* CSS */
.animated {
  animation: slide 1s ease-in-out;
  will-change: transform;
}

@keyframes slide {
  from { transform: translateX(0); }
  to { transform: translateX(100px); }
}

/* JavaScript */
element.classList.add('animated');`,
    applicableTo: ['long_task', 'gpu_stall', 'heavy_paint'],
    warnings: [
      'CSS animations have limited dynamic control',
      'Use transform instead of left/top for GPU acceleration',
      'Remove will-change after animation completes',
    ],
  },
};

/**
 * Frame budget for 60fps (default)
 */
const DEFAULT_FRAME_BUDGET_MS = 16.67;

@Injectable()
export class JSSuggester implements ISuggester {
  readonly name = 'JSSuggester';
  readonly supportedTypes: DetectionType[] = [
    'long_task',
    'layout_thrashing',
    'forced_reflow',
  ];

  constructor(private readonly speedupCalculator: SpeedupCalculatorService) {}

  /**
   * Generate JS suggestion for a detection
   */
  suggest(detection: Detection): Promise<JSSuggestion | null> {
    switch (detection.type) {
      case 'long_task':
        return Promise.resolve(
          this.suggestForLongTask(detection as LongTaskDetection),
        );
      case 'layout_thrashing':
        return Promise.resolve(
          this.suggestForLayoutThrashing(detection as LayoutThrashDetection),
        );
      case 'forced_reflow':
        return Promise.resolve(this.suggestForForcedReflow(detection));
      default:
        return Promise.resolve(null);
    }
  }

  /**
   * Generate suggestion for long task
   */
  private suggestForLongTask(detection: LongTaskDetection): JSSuggestion {
    // Choose pattern based on task characteristics
    const pattern = this.selectPatternForLongTask(detection);
    const patternSuggestion = JS_PATTERNS[pattern];

    const target = detection.functionName || 'function';
    const file = detection.file || 'unknown';
    const line = detection.line || 0;

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.cpuMs,
      DEFAULT_FRAME_BUDGET_MS,
      pattern,
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      pattern,
      'long_task',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'js',
      target: `${target} (${file}:${line})`,
      description: `${patternSuggestion.description}. Function "${target}" took ${detection.cpuMs.toFixed(1)}ms, blocking the main thread.`,
      patch: this.generatePatch(target, patternSuggestion, detection),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(patternSuggestion, detection),
      affectedFiles: file !== 'unknown' ? [file] : [],
      pattern,
      codeSnippet: patternSuggestion.codeTemplate,
      suggestedCode: patternSuggestion.suggestedTemplate,
    };
  }

  /**
   * Generate suggestion for layout thrashing (JS-based fix)
   */
  private suggestForLayoutThrashing(
    detection: LayoutThrashDetection,
  ): JSSuggestion {
    const pattern: JSFixPattern = 'batch_dom_writes';
    const patternSuggestion = JS_PATTERNS[pattern];

    const target = detection.selector || 'element';

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.reflowCostMs,
      DEFAULT_FRAME_BUDGET_MS,
      pattern,
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      pattern,
      'layout_thrashing',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'js',
      target,
      description: `${patternSuggestion.description}. Layout thrashing on "${target}" caused ${detection.occurrences} forced reflows costing ${detection.reflowCostMs.toFixed(1)}ms.`,
      patch: this.generatePatch(target, patternSuggestion, detection),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(patternSuggestion, detection),
      affectedFiles: [],
      pattern,
      codeSnippet: patternSuggestion.codeTemplate,
      suggestedCode: patternSuggestion.suggestedTemplate,
    };
  }

  /**
   * Generate suggestion for forced reflow
   */
  private suggestForForcedReflow(detection: Detection): JSSuggestion {
    const pattern: JSFixPattern = 'use_raf';
    const patternSuggestion = JS_PATTERNS[pattern];

    const target = detection.location.selector || 'element';

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.metrics.durationMs,
      DEFAULT_FRAME_BUDGET_MS,
      pattern,
    );

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      pattern,
      'forced_reflow',
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'js',
      target,
      description: `${patternSuggestion.description}. Forced reflow on "${target}" took ${detection.metrics.durationMs.toFixed(1)}ms.`,
      patch: this.generatePatch(target, patternSuggestion, detection),
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(patternSuggestion, detection),
      affectedFiles: [],
      pattern,
      codeSnippet: patternSuggestion.codeTemplate,
      suggestedCode: patternSuggestion.suggestedTemplate,
    };
  }

  /**
   * Select the best pattern for a long task based on its characteristics
   */
  private selectPatternForLongTask(detection: LongTaskDetection): JSFixPattern {
    const { cpuMs, correlatedFrameDrops, functionName } = detection;

    // Very long tasks (>100ms) - consider Web Worker
    if (cpuMs > 100) {
      return 'move_to_worker';
    }

    // Tasks correlated with frame drops - use RAF
    if (correlatedFrameDrops > 0) {
      return 'use_raf';
    }

    // Event handler patterns - consider debounce
    const eventHandlerPatterns = [
      'scroll',
      'resize',
      'mousemove',
      'input',
      'keydown',
      'keyup',
    ];
    if (
      eventHandlerPatterns.some(
        (p) => functionName?.toLowerCase().includes(p) ?? false,
      )
    ) {
      return 'debounce';
    }

    // Animation-related - use CSS animation
    const animationPatterns = ['animate', 'animation', 'transition', 'tween'];
    if (
      animationPatterns.some(
        (p) => functionName?.toLowerCase().includes(p) ?? false,
      )
    ) {
      return 'use_css_animation';
    }

    // Default to RAF for general long tasks
    return 'use_raf';
  }

  /**
   * Generate JS patch content
   */
  private generatePatch(
    target: string,
    suggestion: JSPatternSuggestion,
    detection: Detection,
  ): string {
    const header = `/**
 * Performance optimization for: ${target}
 * Issue: ${detection.type}
 * Impact: ${detection.metrics.durationMs.toFixed(1)}ms
 * Pattern: ${suggestion.pattern}
 */

`;

    return header + suggestion.suggestedTemplate;
  }

  /**
   * Generate warnings based on suggestion and detection
   */
  private generateWarnings(
    suggestion: JSPatternSuggestion,
    detection: Detection,
  ): string[] {
    const warnings: string[] = [];

    // Add pattern-specific warnings
    for (const warning of suggestion.warnings) {
      warnings.push(`ℹ️ ${warning}`);
    }

    // Add detection-specific warnings
    if (detection.type === 'long_task') {
      const longTask = detection as LongTaskDetection;
      if (longTask.cpuMs > 50) {
        warnings.push(
          `⚠️ LONG TASK: This task blocks the main thread for ${longTask.cpuMs.toFixed(1)}ms, exceeding the 50ms threshold.`,
        );
      }
      if (longTask.correlatedFrameDrops > 0) {
        warnings.push(
          `⚠️ FRAME DROPS: This task is correlated with ${longTask.correlatedFrameDrops} dropped frames.`,
        );
      }
    }

    // Web Worker specific warnings
    if (suggestion.pattern === 'move_to_worker') {
      warnings.push(
        '⚠️ WORKER MIGRATION: Ensure the function does not require DOM access before moving to a Worker.',
      );
    }

    // Debounce specific warnings
    if (suggestion.pattern === 'debounce') {
      warnings.push(
        '⚠️ RESPONSIVENESS: Debouncing adds latency. Test with real users to ensure acceptable UX.',
      );
    }

    return warnings;
  }

  /**
   * Get all available JS patterns
   */
  getPatterns(): Record<JSFixPattern, JSPatternSuggestion> {
    return { ...JS_PATTERNS };
  }
}
