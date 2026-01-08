/**
 * Native Suggester
 * Generates human-readable suggestions for Swift/native code issues
 *
 * Requirements: 15.23
 * - Produces human-readable suggestions (not patches)
 * - Includes links to Apple performance documentation
 * - Native Swift code is NOT auto-modified
 */

import { Injectable } from '@nestjs/common';
import type {
  Detection,
  DetectionType,
  LongTaskDetection,
  GPUStallDetection,
  HeavyPaintDetection,
  LayoutThrashDetection,
} from '../shared/types/index.js';
import type {
  Suggestion,
  NativeSuggestion,
} from '../shared/types/suggestion.types.js';
import type { ISuggester } from './interfaces/index.js';
import { SpeedupCalculatorService } from './speedup-calculator.service.js';
import { SuggesterService } from './suggester.service.js';

/**
 * Apple documentation links for performance topics
 */
const APPLE_DOCS = {
  // Core Animation
  coreAnimation:
    'https://developer.apple.com/documentation/quartzcore/optimizing_core_animation_performance',
  caDisplayLink:
    'https://developer.apple.com/documentation/quartzcore/cadisplaylink',
  layerBacking:
    'https://developer.apple.com/documentation/appkit/nsview/1483695-wantslayer',

  // Grand Central Dispatch
  gcd: 'https://developer.apple.com/documentation/dispatch',
  dispatchAsync:
    'https://developer.apple.com/documentation/dispatch/dispatchqueue/2016098-async',
  qos: 'https://developer.apple.com/documentation/dispatch/dispatchqos',

  // Performance
  instruments:
    'https://developer.apple.com/documentation/xcode/improving-your-app-s-performance',
  timeProfiler:
    'https://developer.apple.com/documentation/xcode/analyzing-the-performance-of-your-code',
  metalPerformance:
    'https://developer.apple.com/documentation/metal/optimizing_performance_with_the_gpu_counters_instrument',

  // Memory
  memoryManagement:
    'https://developer.apple.com/documentation/swift/manual-memory-management',
  arc: 'https://developer.apple.com/documentation/swift/automatic-reference-counting',

  // WebKit
  wkWebView: 'https://developer.apple.com/documentation/webkit/wkwebview',
  webViewPerformance:
    'https://developer.apple.com/documentation/webkit/wkwebviewconfiguration',

  // SwiftUI
  swiftUIPerformance:
    'https://developer.apple.com/documentation/swiftui/improving-your-app-s-performance',
  viewIdentity: 'https://developer.apple.com/documentation/swiftui/view/id(_:)',

  // UIKit
  uiKitPerformance:
    'https://developer.apple.com/documentation/uikit/views_and_controls/optimizing_views_for_variable_refresh_rate_displays',
  drawRect:
    'https://developer.apple.com/documentation/uikit/uiview/1622529-draw',
};

/**
 * Native fix patterns with guidance
 */
interface NativePatternGuidance {
  pattern: string;
  description: string;
  fixGuidance: string;
  codeExample?: string;
  documentationLinks: string[];
  relatedFrameworks: string[];
  applicableTo: DetectionType[];
}

/**
 * Native performance patterns
 */
const NATIVE_PATTERNS: Record<string, NativePatternGuidance> = {
  dispatch_async: {
    pattern: 'dispatch_async',
    description: 'Move heavy computation off the main thread using GCD',
    fixGuidance:
      'Use DispatchQueue.global() to offload CPU-intensive work from the main thread. Return to the main queue for UI updates.',
    codeExample: `// Move heavy work off main thread
DispatchQueue.global(qos: .userInitiated).async {
    let result = self.heavyComputation()
    
    DispatchQueue.main.async {
        self.updateUI(with: result)
    }
}`,
    documentationLinks: [
      APPLE_DOCS.gcd,
      APPLE_DOCS.dispatchAsync,
      APPLE_DOCS.qos,
    ],
    relatedFrameworks: ['Dispatch', 'Foundation'],
    applicableTo: ['long_task'],
  },

  cadisplaylink: {
    pattern: 'cadisplaylink',
    description: 'Use CADisplayLink for frame-synchronized updates',
    fixGuidance:
      'Replace timer-based animations with CADisplayLink to synchronize with the display refresh rate and avoid frame drops.',
    codeExample: `// Use CADisplayLink for smooth animations
class AnimationController {
    private var displayLink: CADisplayLink?
    
    func startAnimation() {
        displayLink = CADisplayLink(target: self, selector: #selector(update))
        displayLink?.add(to: .main, forMode: .common)
    }
    
    @objc func update(_ displayLink: CADisplayLink) {
        let elapsed = displayLink.targetTimestamp - displayLink.timestamp
        // Update animation based on elapsed time
    }
    
    func stopAnimation() {
        displayLink?.invalidate()
        displayLink = nil
    }
}`,
    documentationLinks: [APPLE_DOCS.caDisplayLink, APPLE_DOCS.coreAnimation],
    relatedFrameworks: ['QuartzCore', 'CoreAnimation'],
    applicableTo: ['long_task', 'gpu_stall', 'heavy_paint'],
  },

  layer_rasterization: {
    pattern: 'layer_rasterization',
    description: 'Enable layer rasterization for complex static content',
    fixGuidance:
      'Set shouldRasterize = true on layers with complex content that does not change frequently. This caches the layer as a bitmap.',
    codeExample: `// Rasterize complex static layers
view.layer.shouldRasterize = true
view.layer.rasterizationScale = UIScreen.main.scale

// Note: Only use for content that doesn't change frequently
// Disable when content updates to avoid re-rasterization cost`,
    documentationLinks: [APPLE_DOCS.coreAnimation, APPLE_DOCS.layerBacking],
    relatedFrameworks: ['QuartzCore', 'UIKit'],
    applicableTo: ['gpu_stall', 'heavy_paint'],
  },

  avoid_offscreen_rendering: {
    pattern: 'avoid_offscreen_rendering',
    description: 'Avoid offscreen rendering triggers like shadows and masks',
    fixGuidance:
      'Offscreen rendering is expensive. Use shadowPath for shadows, pre-render masks as images, and avoid cornerRadius with masksToBounds.',
    codeExample: `// Bad: Triggers offscreen rendering
view.layer.cornerRadius = 10
view.layer.masksToBounds = true
view.layer.shadowOpacity = 0.5

// Good: Use shadowPath to avoid offscreen rendering
view.layer.shadowPath = UIBezierPath(
    roundedRect: view.bounds,
    cornerRadius: 10
).cgPath

// Good: Use pre-rendered corner mask image
let maskImage = createRoundedMaskImage(size: view.bounds.size, radius: 10)
view.layer.mask = CALayer()
view.layer.mask?.contents = maskImage.cgImage`,
    documentationLinks: [APPLE_DOCS.coreAnimation, APPLE_DOCS.instruments],
    relatedFrameworks: ['QuartzCore', 'UIKit', 'CoreGraphics'],
    applicableTo: ['gpu_stall', 'heavy_paint'],
  },

  batch_layout_updates: {
    pattern: 'batch_layout_updates',
    description: 'Batch layout updates to avoid layout thrashing',
    fixGuidance:
      'Use setNeedsLayout() and layoutIfNeeded() strategically. Batch multiple layout changes together and avoid reading layout properties immediately after writing.',
    codeExample: `// Bad: Layout thrashing
for item in items {
    let height = view.frame.height  // Read
    view.frame.size.height = height + 10  // Write
}

// Good: Batch layout updates
UIView.performWithoutAnimation {
    for item in items {
        item.view.setNeedsLayout()
    }
}
view.layoutIfNeeded()  // Single layout pass`,
    documentationLinks: [APPLE_DOCS.uiKitPerformance, APPLE_DOCS.instruments],
    relatedFrameworks: ['UIKit', 'AppKit'],
    applicableTo: ['layout_thrashing', 'forced_reflow'],
  },

  swiftui_identity: {
    pattern: 'swiftui_identity',
    description:
      'Use stable identifiers in SwiftUI to prevent unnecessary redraws',
    fixGuidance:
      'Provide stable id() values for views in ForEach and List. Avoid using array indices as identifiers when the array can change.',
    codeExample: `// Bad: Using index as identifier
ForEach(items.indices, id: \\.self) { index in
    ItemView(item: items[index])
}

// Good: Using stable identifier
ForEach(items, id: \\.id) { item in
    ItemView(item: item)
}

// Good: Identifiable conformance
struct Item: Identifiable {
    let id: UUID
    var name: String
}`,
    documentationLinks: [
      APPLE_DOCS.swiftUIPerformance,
      APPLE_DOCS.viewIdentity,
    ],
    relatedFrameworks: ['SwiftUI'],
    applicableTo: ['layout_thrashing', 'heavy_paint'],
  },

  webview_optimization: {
    pattern: 'webview_optimization',
    description: 'Optimize WKWebView configuration for performance',
    fixGuidance:
      'Configure WKWebView with appropriate preferences. Disable unnecessary features, use process pool sharing, and consider prewarming.',
    codeExample: `// Optimized WKWebView configuration
let config = WKWebViewConfiguration()

// Share process pool for multiple web views
config.processPool = sharedProcessPool

// Disable features you don't need
config.preferences.javaScriptCanOpenWindowsAutomatically = false

// Enable hardware acceleration
config.preferences.setValue(true, forKey: "acceleratedDrawingEnabled")

// Prewarm web view
let webView = WKWebView(frame: .zero, configuration: config)
webView.load(URLRequest(url: URL(string: "about:blank")!))`,
    documentationLinks: [APPLE_DOCS.wkWebView, APPLE_DOCS.webViewPerformance],
    relatedFrameworks: ['WebKit'],
    applicableTo: ['long_task', 'gpu_stall'],
  },

  metal_optimization: {
    pattern: 'metal_optimization',
    description: 'Optimize Metal rendering for GPU performance',
    fixGuidance:
      'Use triple buffering, minimize state changes, batch draw calls, and use GPU counters to identify bottlenecks.',
    codeExample: `// Triple buffering for smooth rendering
let inflightSemaphore = DispatchSemaphore(value: 3)

func draw(in view: MTKView) {
    _ = inflightSemaphore.wait(timeout: .distantFuture)
    
    guard let commandBuffer = commandQueue.makeCommandBuffer() else { return }
    
    commandBuffer.addCompletedHandler { [weak self] _ in
        self?.inflightSemaphore.signal()
    }
    
    // Batch draw calls
    // Minimize state changes
    // Use indirect rendering for dynamic content
    
    commandBuffer.commit()
}`,
    documentationLinks: [APPLE_DOCS.metalPerformance, APPLE_DOCS.instruments],
    relatedFrameworks: ['Metal', 'MetalKit'],
    applicableTo: ['gpu_stall', 'heavy_paint'],
  },
};

/**
 * Frame budget for 60fps (default)
 */
const DEFAULT_FRAME_BUDGET_MS = 16.67;

@Injectable()
export class NativeSuggester implements ISuggester {
  readonly name = 'NativeSuggester';
  readonly supportedTypes: DetectionType[] = [
    'long_task',
    'gpu_stall',
    'heavy_paint',
    'layout_thrashing',
    'forced_reflow',
  ];

  constructor(private readonly speedupCalculator: SpeedupCalculatorService) {}

  /**
   * Generate native suggestion for a detection
   * Returns null if the detection is not from a native source
   */
  suggest(detection: Detection): Promise<Suggestion | null> {
    // Check if this detection is from native code
    if (!this.isNativeDetection(detection)) {
      return Promise.resolve(null);
    }

    let result: Suggestion | null;
    switch (detection.type) {
      case 'long_task':
        result = this.suggestForLongTask(detection as LongTaskDetection);
        break;
      case 'gpu_stall':
        result = this.suggestForGPUStall(detection as GPUStallDetection);
        break;
      case 'heavy_paint':
        result = this.suggestForHeavyPaint(detection as HeavyPaintDetection);
        break;
      case 'layout_thrashing':
        result = this.suggestForLayoutThrashing(
          detection as LayoutThrashDetection,
        );
        break;
      case 'forced_reflow':
        result = this.suggestForForcedReflow(detection);
        break;
      default:
        result = null;
    }
    return Promise.resolve(result);
  }

  /**
   * Check if a detection is from native code
   */
  private isNativeDetection(detection: Detection): boolean {
    const file = detection.location.file || '';
    const nativePatterns = [
      /\.swift$/,
      /\.m$/,
      /\.mm$/,
      /\.h$/,
      /\.cpp$/,
      /\.c$/,
    ];
    return nativePatterns.some((pattern) => pattern.test(file));
  }

  /**
   * Generate suggestion for long task in native code
   */
  private suggestForLongTask(detection: LongTaskDetection): NativeSuggestion {
    const pattern = NATIVE_PATTERNS.dispatch_async!;
    const target = detection.functionName || 'function';
    const file = detection.file || 'unknown';
    const line = detection.line || 0;

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.cpuMs,
      DEFAULT_FRAME_BUDGET_MS,
      'move_to_worker', // Use similar efficiency factor
    );

    return this.createNativeSuggestion({
      pattern,
      target: `${target} (${file}:${line})`,
      description: `${pattern.description}. Function "${target}" took ${detection.cpuMs.toFixed(1)}ms, blocking the main thread.`,
      calculation,
      detection,
    });
  }

  /**
   * Generate suggestion for GPU stall in native code
   */
  private suggestForGPUStall(detection: GPUStallDetection): NativeSuggestion {
    // Choose pattern based on stall type
    let pattern: NativePatternGuidance;
    switch (detection.stallType) {
      case 'texture_upload':
        pattern = NATIVE_PATTERNS.metal_optimization!;
        break;
      case 'raster':
        pattern = NATIVE_PATTERNS.layer_rasterization!;
        break;
      default:
        pattern = NATIVE_PATTERNS.avoid_offscreen_rendering!;
    }

    const target = detection.element || 'element';

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.stallMs,
      DEFAULT_FRAME_BUDGET_MS,
      'will_change', // Use similar efficiency factor
    );

    return this.createNativeSuggestion({
      pattern,
      target,
      description: `${pattern.description}. GPU stall on "${target}" lasted ${detection.stallMs.toFixed(1)}ms (${detection.stallType}).`,
      calculation,
      detection,
    });
  }

  /**
   * Generate suggestion for heavy paint in native code
   */
  private suggestForHeavyPaint(
    detection: HeavyPaintDetection,
  ): NativeSuggestion {
    const pattern = NATIVE_PATTERNS.layer_rasterization!;
    const target = detection.location.element || 'view';

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.paintTimeMs,
      DEFAULT_FRAME_BUDGET_MS,
      'contain_property', // Use similar efficiency factor
    );

    return this.createNativeSuggestion({
      pattern,
      target,
      description: `${pattern.description}. Heavy paint on "${target}" took ${detection.paintTimeMs.toFixed(1)}ms with ${detection.layerCount} layers.`,
      calculation,
      detection,
    });
  }

  /**
   * Generate suggestion for layout thrashing in native code
   */
  private suggestForLayoutThrashing(
    detection: LayoutThrashDetection,
  ): NativeSuggestion {
    const pattern = NATIVE_PATTERNS.batch_layout_updates!;
    const target = detection.selector || 'view';

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.reflowCostMs,
      DEFAULT_FRAME_BUDGET_MS,
      'batch_dom_writes', // Use similar efficiency factor
    );

    return this.createNativeSuggestion({
      pattern,
      target,
      description: `${pattern.description}. Layout thrashing on "${target}" caused ${detection.occurrences} forced layouts costing ${detection.reflowCostMs.toFixed(1)}ms.`,
      calculation,
      detection,
    });
  }

  /**
   * Generate suggestion for forced reflow in native code
   */
  private suggestForForcedReflow(detection: Detection): NativeSuggestion {
    const pattern = NATIVE_PATTERNS.batch_layout_updates!;
    const target = detection.location.selector || 'view';

    const calculation = this.speedupCalculator.calculateSpeedup(
      detection.metrics.durationMs,
      DEFAULT_FRAME_BUDGET_MS,
      'batch_dom_writes',
    );

    return this.createNativeSuggestion({
      pattern,
      target,
      description: `${pattern.description}. Forced layout on "${target}" took ${detection.metrics.durationMs.toFixed(1)}ms.`,
      calculation,
      detection,
    });
  }

  /**
   * Create a native suggestion from pattern and detection
   */
  private createNativeSuggestion(params: {
    pattern: NativePatternGuidance;
    target: string;
    description: string;
    calculation: {
      speedupPct: number;
      confidence: 'high' | 'medium' | 'low';
      issueTimeMs: number;
      totalFrameTimeMs: number;
      efficiencyFactor: number;
    };
    detection: Detection;
  }): NativeSuggestion {
    const { pattern, target, description, calculation, detection } = params;

    const explanation = this.speedupCalculator.generateExplanation(
      calculation,
      pattern.pattern,
      detection.type,
    );

    return {
      id: SuggesterService.generateSuggestionId(),
      type: 'native',
      target,
      description,
      patch: '', // Native suggestions don't have patches
      estimatedSpeedupPct: calculation.speedupPct,
      speedupExplanation: explanation,
      confidence: calculation.confidence,
      warnings: this.generateWarnings(pattern, detection),
      affectedFiles: detection.location.file ? [detection.location.file] : [],
      source: 'native',
      fixTargetType: 'suggestion-only',
      platform: this.detectPlatform(detection),
      fixGuidance: pattern.fixGuidance,
      codeExample: pattern.codeExample,
      documentationLinks: pattern.documentationLinks,
      relatedFrameworks: pattern.relatedFrameworks,
    };
  }

  /**
   * Detect the native platform from the detection
   */
  private detectPlatform(detection: Detection): 'swift' | 'objc' | 'native' {
    const file = detection.location.file || '';
    if (file.endsWith('.swift')) return 'swift';
    if (file.endsWith('.m') || file.endsWith('.mm')) return 'objc';
    return 'native';
  }

  /**
   * Generate warnings for native suggestions
   */
  private generateWarnings(
    pattern: NativePatternGuidance,
    detection: Detection,
  ): string[] {
    const warnings: string[] = [];

    // Add general native warning
    warnings.push(
      '⚠️ MANUAL IMPLEMENTATION REQUIRED: This suggestion is for native code and cannot be auto-patched.',
    );

    // Add pattern-specific warnings
    if (pattern.pattern === 'dispatch_async') {
      warnings.push(
        'ℹ️ Ensure UI updates are dispatched back to the main queue.',
      );
      warnings.push(
        'ℹ️ Consider using async/await for cleaner asynchronous code in Swift 5.5+.',
      );
    }

    if (pattern.pattern === 'layer_rasterization') {
      warnings.push(
        'ℹ️ Only rasterize layers with content that changes infrequently.',
      );
      warnings.push(
        'ℹ️ Set rasterizationScale to match screen scale for crisp rendering.',
      );
    }

    if (pattern.pattern === 'avoid_offscreen_rendering') {
      warnings.push(
        'ℹ️ Use Instruments Core Animation template to verify offscreen rendering is eliminated.',
      );
    }

    // Add severity-based warnings
    if (detection.severity === 'critical') {
      warnings.push(
        '● CRITICAL: This issue significantly impacts user experience and should be prioritized.',
      );
    }

    return warnings;
  }

  /**
   * Get all available native patterns
   */
  getPatterns(): Record<string, NativePatternGuidance> {
    return { ...NATIVE_PATTERNS };
  }
}
