# FrameSampler - Swift Instrumentation SDK

A lightweight frame timing and performance collection SDK for iOS/macOS apps with WebKit WebViews. Designed to work with the [render-debugger](../README.md) CLI tool.

## Features

- **Frame Timing Collection**: Uses CADisplayLink for accurate frame timing
- **Dropped Frame Detection**: Automatically detects frames exceeding budget
- **Long Task Detection**: Uses os_signpost and PerformanceObserver JS bridge
- **Trace Emission**: Outputs sanitized JSON traces compatible with render-debugger
- **Sampling Controls**: Configurable sampling rate for production use
- **Admin-Only Triggers**: Restrict trace collection to admin users
- **Short-Lived Sessions**: 5-15 second trace sessions to minimize overhead

## Requirements

- iOS 13.0+ / macOS 10.15+ / tvOS 13.0+
- Swift 5.7+
- Xcode 14.0+

## Installation

### Swift Package Manager

Add the following to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/your-org/render-debugger-swift-sdk.git", from: "1.0.0")
]
```

Or in Xcode: File → Add Packages → Enter the repository URL

## Quick Start

### Basic Frame Sampling

```swift
import FrameSampler

// Create and start frame sampler
let sampler = FrameSampler(config: .default60fps)
sampler.start()

// ... run your app/scenario

// Stop and get results
sampler.stop()
let stats = sampler.calculateStatistics()
print("Average FPS: \(stats.averageFPS)")
print("Dropped frames: \(stats.droppedFramePercentage)%")
```

### Complete Trace Session

```swift
import FrameSampler

// Create session with development config (100% sampling)
let session = TraceSession(config: .development)

// Start a trace session
session.start(name: "scroll-test", url: "https://example.com") { result in
    if result.success {
        print("Trace saved to: \(result.traceURL!)")
        print("Frames: \(result.frameCount), Dropped: \(result.droppedFrameCount)")
    }
}

// Session automatically stops after max duration (15s default)
// Or stop manually:
session.stop()
```

### Production Configuration

```swift
// Use production config (10% sampling, admin-only)
let session = TraceSession(config: .production)
session.isAdminUser = currentUser.isAdmin

// Or with automatic triggering on performance issues
let session = TraceSession(config: .productionAutomatic(
    samplingRate: 0.1,
    threshold: AutomaticTriggerThreshold(
        droppedFramePercentage: 15.0,
        cooldownSeconds: 120.0
    )
))
session.startAutomaticMonitoring()
```

### WebView Integration

```swift
import WebKit
import FrameSampler

class MyViewController: UIViewController {
    let webView = WKWebView()
    let longTaskDetector = LongTaskDetector()

    override func viewDidLoad() {
        super.viewDidLoad()

        // Inject PerformanceObserver for WebView long task detection
        longTaskDetector.injectPerformanceObserver(into: webView)
        longTaskDetector.delegate = self
        longTaskDetector.start()
    }
}

extension MyViewController: LongTaskDetectorDelegate {
    func longTaskDetector(_ detector: LongTaskDetector, didDetectTask task: LongTask) {
        print("Long task detected: \(task.durationMs)ms from \(task.source)")
    }
}
```

### Native Task Measurement

```swift
let detector = LongTaskDetector()
detector.start()

// Measure synchronous work
let result = detector.measure(name: "processData") {
    // Heavy computation
    return processLargeDataset()
}

// Or manually mark tasks
detector.beginTask(name: "networkRequest", category: "Network")
// ... async work
detector.endTask(name: "networkRequest")
```

## API Reference

### FrameSampler

The main class for collecting frame timing data.

```swift
// Configuration
let config = FrameSamplerConfig(
    fpsTarget: 60,                    // Target FPS (60 or 120)
    detectDroppedFrames: true,        // Auto-detect dropped frames
    droppedFrameTolerance: 1.5        // 50% over budget = dropped
)

// Usage
let sampler = FrameSampler(config: config)
sampler.delegate = self
sampler.start()
// ...
sampler.stop()

// Get data
let frames = sampler.getFrames()
let stats = sampler.calculateStatistics()
```

### LongTaskDetector

Detects tasks exceeding the threshold duration (default 50ms).

```swift
let config = LongTaskDetectorConfig(
    thresholdMs: 50.0,                // Task duration threshold
    enableNativeDetection: true,      // Use os_signpost
    enableWebViewDetection: true      // Use PerformanceObserver
)

let detector = LongTaskDetector(config: config)
detector.start()
```

### TraceSession

Manages complete trace collection sessions with lifecycle controls.

```swift
// Development (100% sampling, open trigger)
let devSession = TraceSession(config: .development)

// Production (10% sampling, admin-only)
let prodSession = TraceSession(config: .production)

// Custom configuration
let customConfig = TraceSessionConfig(
    samplingRate: 0.5,                // 50% sampling
    triggerMode: .adminOnly,          // Require admin
    maxDurationSeconds: 10.0,         // 10s max
    isDevelopment: false
)
```

### TraceEmitter

Emits sanitized JSON trace files.

```swift
let emitter = TraceEmitter(config: TraceEmitterConfig(
    outputDirectory: customDir,
    sanitizeUrls: true,               // Remove query params
    prettyPrint: false                // Compact JSON
))

let traceURL = try emitter.emit(
    name: "my-trace",
    frames: frames,
    longTasks: longTasks,
    url: "https://example.com",
    fpsTarget: 60
)
```

## Output Format

The SDK outputs JSON traces compatible with the render-debugger CLI:

```json
{
  "version": "1.0",
  "trace_id": "uuid",
  "name": "scroll-test",
  "duration_ms": 15000,
  "frames": [
    {
      "frame_id": 0,
      "start_timestamp": 0,
      "end_timestamp": 16667,
      "duration_ms": 16.667,
      "dropped": false
    }
  ],
  "long_tasks": [
    {
      "start_timestamp": 1000000,
      "duration_ms": 75.0,
      "name": "heavyComputation",
      "source": "native"
    }
  ],
  "dom_signals": [],
  "metadata": {
    "os_version": "17.0",
    "device_model": "iPhone15,2",
    "fps_target": 60,
    "sdk_version": "1.0.0",
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

## Using with render-debugger CLI

1. Collect traces using the Swift SDK in your app
2. Export trace files to a shared location
3. Analyze with render-debugger:

```bash
# Analyze a native trace
render-debugger analyze trace.json --adapter webkit-native --name "iOS scroll test"

# Compare traces
render-debugger compare baseline.json current.json --fail-on high
```

## Privacy & Security

- **No PII**: Traces contain only performance data, no user content
- **URL Sanitization**: Query params and fragments are stripped by default
- **Local Storage**: All traces stored locally, no network transmission
- **Sampling**: Configurable sampling rate for production (default 10%)
- **Admin Controls**: Optional admin-only trigger mode
- **Short Sessions**: 5-15 second max to minimize data collection

## License

MIT License - See LICENSE file for details
