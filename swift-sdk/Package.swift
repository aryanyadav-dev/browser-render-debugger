// swift-tools-version:5.7
// The swift-tools-version declares the minimum version of Swift required to build this package.

/**
 * FrameSampler - Swift Instrumentation SDK for render-debugger
 *
 * A lightweight frame timing and performance collection SDK for iOS/macOS apps
 * with WebKit WebViews. Designed to work with the render-debugger CLI tool.
 *
 * ## Features
 *
 * - **Frame Timing Collection**: Uses CADisplayLink for accurate frame timing
 * - **Dropped Frame Detection**: Automatically detects frames exceeding budget
 * - **Long Task Detection**: Uses os_signpost and PerformanceObserver JS bridge
 * - **Trace Emission**: Outputs sanitized JSON traces compatible with render-debugger
 * - **Sampling Controls**: Configurable sampling rate for production use
 * - **Admin-Only Triggers**: Restrict trace collection to admin users
 * - **Short-Lived Sessions**: 5-15 second trace sessions to minimize overhead
 *
 * ## Requirements
 *
 * - iOS 13.0+ / macOS 10.15+ / tvOS 13.0+
 * - Swift 5.7+
 * - Xcode 14.0+
 *
 * ## Installation
 *
 * ### Swift Package Manager
 *
 * Add the following to your `Package.swift`:
 *
 * ```swift
 * dependencies: [
 *     .package(url: "https://github.com/your-org/render-debugger-swift-sdk.git", from: "1.0.0")
 * ]
 * ```
 *
 * Or in Xcode: File → Add Packages → Enter the repository URL
 *
 * ## Quick Start
 *
 * ### Basic Frame Sampling
 *
 * ```swift
 * import FrameSampler
 *
 * // Create and start frame sampler
 * let sampler = FrameSampler(config: .default60fps)
 * sampler.start()
 *
 * // ... run your app/scenario
 *
 * // Stop and get results
 * sampler.stop()
 * let stats = sampler.calculateStatistics()
 * print("Average FPS: \(stats.averageFPS)")
 * print("Dropped frames: \(stats.droppedFramePercentage)%")
 * ```
 *
 * ### Complete Trace Session
 *
 * ```swift
 * import FrameSampler
 *
 * // Create session with development config (100% sampling)
 * let session = TraceSession(config: .development)
 *
 * // Start a trace session
 * session.start(name: "scroll-test", url: "https://example.com") { result in
 *     if result.success {
 *         print("Trace saved to: \(result.traceURL!)")
 *         print("Frames: \(result.frameCount), Dropped: \(result.droppedFrameCount)")
 *     }
 * }
 *
 * // Session automatically stops after max duration (15s default)
 * // Or stop manually:
 * session.stop()
 * ```
 *
 * ### Production Configuration
 *
 * ```swift
 * // Use production config (10% sampling, admin-only)
 * let session = TraceSession(config: .production)
 * session.isAdminUser = currentUser.isAdmin
 *
 * // Or with automatic triggering on performance issues
 * let session = TraceSession(config: .productionAutomatic(
 *     samplingRate: 0.1,
 *     threshold: AutomaticTriggerThreshold(
 *         droppedFramePercentage: 15.0,
 *         cooldownSeconds: 120.0
 *     )
 * ))
 * session.startAutomaticMonitoring()
 * ```
 *
 * ### WebView Integration
 *
 * ```swift
 * import WebKit
 * import FrameSampler
 *
 * class MyViewController: UIViewController {
 *     let webView = WKWebView()
 *     let longTaskDetector = LongTaskDetector()
 *
 *     override func viewDidLoad() {
 *         super.viewDidLoad()
 *
 *         // Inject PerformanceObserver for WebView long task detection
 *         longTaskDetector.injectPerformanceObserver(into: webView)
 *         longTaskDetector.delegate = self
 *         longTaskDetector.start()
 *     }
 * }
 *
 * extension MyViewController: LongTaskDetectorDelegate {
 *     func longTaskDetector(_ detector: LongTaskDetector, didDetectTask task: LongTask) {
 *         print("Long task detected: \(task.durationMs)ms from \(task.source)")
 *     }
 * }
 * ```
 *
 * ## Output Format
 *
 * The SDK outputs JSON traces compatible with the render-debugger CLI:
 *
 * ```json
 * {
 *   "version": "1.0",
 *   "trace_id": "uuid",
 *   "name": "scroll-test",
 *   "duration_ms": 15000,
 *   "frames": [...],
 *   "long_tasks": [...],
 *   "dom_signals": [],
 *   "metadata": {
 *     "os_version": "17.0",
 *     "device_model": "iPhone15,2",
 *     "fps_target": 60,
 *     "sdk_version": "1.0.0"
 *   }
 * }
 * ```
 *
 * ## Privacy & Security
 *
 * - **No PII**: Traces contain only performance data, no user content
 * - **URL Sanitization**: Query params and fragments are stripped by default
 * - **Local Storage**: All traces stored locally, no network transmission
 * - **Sampling**: Configurable sampling rate for production (default 10%)
 * - **Admin Controls**: Optional admin-only trigger mode
 *
 * ## License
 *
 * MIT License - See LICENSE file for details
 *
 * Requirements: 15.19
 */

import PackageDescription

let package = Package(
    name: "FrameSampler",
    platforms: [
        .iOS(.v13),
        .macOS(.v10_15),
        .tvOS(.v13)
    ],
    products: [
        // Main library product
        .library(
            name: "FrameSampler",
            targets: ["FrameSampler"]
        ),
    ],
    dependencies: [
        // No external dependencies - keeping the SDK lightweight
    ],
    targets: [
        // Main target
        .target(
            name: "FrameSampler",
            dependencies: [],
            path: "Sources/FrameSampler",
            swiftSettings: [
                .define("DEBUG", .when(configuration: .debug))
            ]
        ),
        // Test target
        .testTarget(
            name: "FrameSamplerTests",
            dependencies: ["FrameSampler"],
            path: "Tests/FrameSamplerTests"
        ),
    ],
    swiftLanguageVersions: [.v5]
)
