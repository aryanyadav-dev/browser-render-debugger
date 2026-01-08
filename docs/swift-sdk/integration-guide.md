# Swift SDK Integration Guide

This guide provides step-by-step instructions for integrating the FrameSampler Swift SDK into your iOS/macOS application with WebKit WebViews.

## Overview

The FrameSampler SDK enables performance profiling for WebKit-based browsers and apps. It collects:
- Frame timing data via CADisplayLink
- Dropped frame detection
- Long task detection (native + WebView)
- Sanitized trace output compatible with render-debugger CLI

## Requirements

- iOS 13.0+ / macOS 10.15+ / tvOS 13.0+
- Swift 5.7+
- Xcode 14.0+

---

## Installation

### Swift Package Manager (Recommended)

#### Option 1: Xcode UI

1. Open your project in Xcode
2. Go to **File → Add Packages...**
3. Enter the repository URL:
   ```
   https://github.com/your-org/render-debugger
   ```
4. Select the `swift-sdk` directory
5. Choose version requirements (e.g., "Up to Next Major Version" from 1.0.0)
6. Click **Add Package**

#### Option 2: Package.swift

Add to your `Package.swift` dependencies:

```swift
dependencies: [
    .package(
        url: "https://github.com/your-org/render-debugger.git",
        from: "1.0.0"
    )
]
```

Then add the target dependency:

```swift
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "FrameSampler", package: "render-debugger")
        ]
    )
]
```

### Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/render-debugger.git
   ```

2. Drag the `swift-sdk/Sources/FrameSampler` folder into your Xcode project

3. Ensure "Copy items if needed" is checked

---

## Basic Integration

### Step 1: Import the SDK

```swift
import FrameSampler
```

### Step 2: Create a Frame Sampler

```swift
// Use default 60 FPS configuration
let frameSampler = FrameSampler(config: .default60fps)

// Or for ProMotion displays (120 FPS)
let frameSampler = FrameSampler(config: .default120fps)

// Or custom configuration
let config = FrameSamplerConfig(
    fpsTarget: 60,
    detectDroppedFrames: true,
    droppedFrameTolerance: 1.5  // 50% over budget = dropped
)
let frameSampler = FrameSampler(config: config)
```

### Step 3: Start/Stop Sampling

```swift
// Start collecting frame data
frameSampler.start()

// ... your app runs, user interacts ...

// Stop collecting
frameSampler.stop()

// Get statistics
let stats = frameSampler.calculateStatistics()
print("Average FPS: \(stats.averageFPS)")
print("Dropped frames: \(stats.droppedFramePercentage)%")
print("P95 frame time: \(stats.p95FrameDurationMs)ms")
```

---

## WKWebView Integration

### Step 1: Set Up Long Task Detection

```swift
import WebKit
import FrameSampler

class WebViewController: UIViewController {
    
    let webView = WKWebView()
    let frameSampler = FrameSampler(config: .default60fps)
    let longTaskDetector = LongTaskDetector(config: .default)
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Set up WebView
        view.addSubview(webView)
        webView.frame = view.bounds
        
        // Inject PerformanceObserver for WebView long task detection
        longTaskDetector.injectPerformanceObserver(into: webView)
        longTaskDetector.delegate = self
        
        // Load your content
        webView.load(URLRequest(url: URL(string: "https://example.com")!))
    }
    
    func startProfiling() {
        frameSampler.start()
        longTaskDetector.start()
    }
    
    func stopProfiling() {
        frameSampler.stop()
        longTaskDetector.stop()
        
        // Export trace
        exportTrace()
    }
    
    private func exportTrace() {
        let emitter = TraceEmitter(config: .default)
        
        do {
            let traceURL = try emitter.emit(
                name: "webview-profile",
                frameSampler: frameSampler,
                longTaskDetector: longTaskDetector,
                url: webView.url?.absoluteString,
                scenario: "user-interaction"
            )
            print("Trace saved to: \(traceURL)")
        } catch {
            print("Failed to emit trace: \(error)")
        }
    }
}

// MARK: - LongTaskDetectorDelegate

extension WebViewController: LongTaskDetectorDelegate {
    func longTaskDetector(_ detector: LongTaskDetector, didDetectTask task: LongTask) {
        print("Long task detected: \(task.durationMs)ms")
        if let name = task.name {
            print("   Name: \(name)")
        }
        print("   Source: \(task.source.rawValue)")
    }
}
```

### Step 2: Handle Frame Timing Events (Optional)

```swift
extension WebViewController: FrameSamplerDelegate {
    func frameSampler(_ sampler: FrameSampler, didRecordFrame frame: FrameTiming) {
        // Called for every frame
    }
    
    func frameSampler(_ sampler: FrameSampler, didDetectDroppedFrame frame: FrameTiming) {
        print("Dropped frame: \(frame.durationMs)ms (budget: \(sampler.config.frameBudgetMs)ms)")
    }
}
```

---

## Using Trace Sessions

For production use, `TraceSession` provides lifecycle management, sampling, and admin controls.

### Development Configuration

```swift
// 100% sampling, open trigger, 15s max duration
let session = TraceSession(config: .development)

session.start(name: "scroll-test", url: "https://example.com") { result in
    if result.success {
        print("Trace saved: \(result.traceURL!)")
        print("   Frames: \(result.frameCount)")
        print("   Dropped: \(result.droppedFrameCount)")
        print("   Long tasks: \(result.longTaskCount)")
    } else if let error = result.error {
        print("Failed: \(error.localizedDescription)")
    } else if !result.wasSampled {
        print("Session skipped (sampling)")
    }
}
```

### Production Configuration

```swift
// 10% sampling, admin-only trigger, 10s max duration
let session = TraceSession(config: .production)

// Set admin status based on your auth system
session.isAdminUser = currentUser.hasAdminRole

// Attempt to start (may be rejected if not admin or not sampled)
let started = session.start(name: "prod-trace") { result in
    // Handle result
}

if !started {
    print("Session not started (admin required or not sampled)")
}
```

### Automatic Triggering

```swift
// Automatically trigger traces when performance degrades
let config = TraceSessionConfig.productionAutomatic(
    samplingRate: 0.1,  // 10% of automatic triggers
    threshold: AutomaticTriggerThreshold(
        droppedFramePercentage: 15.0,  // Trigger at 15% dropped frames
        minFramesToObserve: 60,         // After observing 60 frames
        cooldownSeconds: 120.0          // Wait 2 min between triggers
    )
)

let session = TraceSession(config: config)
session.delegate = self

// Start monitoring (runs in background)
session.startAutomaticMonitoring()
```

### Session Delegate

```swift
extension MyClass: TraceSessionDelegate {
    func traceSession(_ session: TraceSession, didStartWithId sessionId: String) {
        print("Session started: \(sessionId)")
    }
    
    func traceSession(_ session: TraceSession, didCompleteWithResult result: TraceSessionResult) {
        if result.success {
            // Upload trace, show notification, etc.
        }
    }
    
    func traceSession(_ session: TraceSession, didChangeState state: TraceSessionState) {
        // Update UI based on state
    }
    
    func traceSessionDidExceedAutomaticThreshold(_ session: TraceSession) {
        print("Performance threshold exceeded, starting trace...")
    }
}
```

---

## Trace Output Configuration

### Custom Output Directory

```swift
let documentsURL = FileManager.default.urls(
    for: .documentDirectory,
    in: .userDomainMask
).first!

let tracesDir = documentsURL.appendingPathComponent("MyApp/Traces")

let emitterConfig = TraceEmitterConfig(
    outputDirectory: tracesDir,
    sanitizeUrls: true,      // Remove query params from URLs
    includeBundleId: true,   // Include app bundle ID in metadata
    prettyPrint: false,      // Compact JSON (smaller files)
    fileNamePrefix: "perf"   // Files named: perf-2024-01-01T12-00-00Z.json
)

let emitter = TraceEmitter(config: emitterConfig)
```

### Managing Trace Files

```swift
let emitter = TraceEmitter(config: .default)

// List all traces
let traces = try emitter.listTraces()
for trace in traces {
    print("Trace: \(trace.lastPathComponent)")
}

// Delete old traces
for trace in traces.dropFirst(10) {  // Keep only 10 most recent
    try emitter.deleteTrace(at: trace)
}

// Delete all traces
try emitter.deleteAllTraces()
```

---

## Native Task Measurement

Track performance of native Swift code:

### Manual Task Marking

```swift
let detector = LongTaskDetector()
detector.start()

// Mark task boundaries
detector.beginTask(name: "processImages", category: "ImageProcessing")

// ... heavy work ...

detector.endTask(name: "processImages")
```

### Automatic Measurement

```swift
// Synchronous
let result = detector.measure(name: "parseJSON") {
    return try JSONDecoder().decode(MyModel.self, from: data)
}

// Async (iOS 13+)
let result = await detector.measureAsync(name: "fetchData") {
    return try await networkService.fetchData()
}
```

---

## Trace Output Format

The SDK outputs JSON traces compatible with render-debugger:

```json
{
  "version": "1.0",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "scroll-test",
  "duration_ms": 15234.5,
  "frames": [
    {
      "frame_id": 0,
      "start_timestamp": 0,
      "end_timestamp": 16667,
      "duration_ms": 16.667,
      "dropped": false,
      "target_timestamp": 16667,
      "actual_presentation_timestamp": 16667
    },
    {
      "frame_id": 1,
      "start_timestamp": 16667,
      "end_timestamp": 50000,
      "duration_ms": 33.333,
      "dropped": true
    }
  ],
  "long_tasks": [
    {
      "start_timestamp": 100000,
      "duration_ms": 75.5,
      "name": "heavyComputation",
      "category": "Processing",
      "source": "native"
    },
    {
      "start_timestamp": 500000,
      "duration_ms": 120.0,
      "name": "longtask",
      "source": "webview",
      "function_name": "processData",
      "file": "https://example.com/app.js"
    }
  ],
  "dom_signals": [],
  "metadata": {
    "bundle_id": "com.example.myapp",
    "app_version": "1.2.3",
    "os_version": "17.0",
    "device_model": "iPhone15,2",
    "screen_size": { "width": 393, "height": 852 },
    "scale": 3.0,
    "timestamp": "2024-01-15T10:30:00Z",
    "fps_target": 60,
    "url": "https://example.com",
    "scenario": "scroll-test",
    "sdk_version": "1.0.0",
    "sampled": false,
    "sampling_rate": null
  }
}
```

---

## Using Traces with render-debugger CLI

### Transfer Traces to Development Machine

```bash
# Using Xcode
# 1. Connect device
# 2. Window → Devices and Simulators
# 3. Select your app → Download Container
# 4. Show Package Contents → Documents/render-debugger-traces/

# Using iCloud/shared folder
# Configure TraceEmitter to write to a shared location

# Using AirDrop
# Implement share functionality in your app
```

### Analyze with render-debugger

```bash
# Analyze a native trace
render-debugger analyze trace.json \
  --adapter webkit-native \
  --name "iOS scroll test"

# Compare baseline vs current
render-debugger compare baseline.json current.json \
  --fail-on high

# Generate HTML report
render-debugger analyze trace.json \
  --adapter webkit-native \
  --out report.html
```

---

## Best Practices

### 1. Use Short Sessions

Keep trace sessions short (5-15 seconds) to:
- Minimize memory usage
- Reduce file sizes
- Focus on specific interactions

```swift
let config = TraceSessionConfig(
    maxDurationSeconds: 10.0,  // 10 second max
    minDurationSeconds: 5.0    // 5 second minimum
)
```

### 2. Sample in Production

Never run 100% sampling in production:

```swift
let config = TraceSessionConfig(
    samplingRate: 0.05,  // 5% of sessions
    triggerMode: .adminOnly
)
```

### 3. Sanitize Sensitive Data

The SDK sanitizes URLs by default, but ensure no PII in task names:

```swift
// ❌ Bad - includes user ID
detector.beginTask(name: "loadUser_\(userId)")

// ✅ Good - generic name
detector.beginTask(name: "loadUserProfile")
```

### 4. Clean Up Old Traces

Implement trace cleanup to manage storage:

```swift
func cleanupOldTraces() {
    let emitter = TraceEmitter(config: .default)
    guard let traces = try? emitter.listTraces() else { return }
    
    // Keep only last 20 traces
    for trace in traces.dropFirst(20) {
        try? emitter.deleteTrace(at: trace)
    }
}
```

### 5. Handle Errors Gracefully

```swift
session.start(name: "test") { result in
    switch (result.success, result.wasSampled, result.error) {
    case (true, true, _):
        // Success - trace saved
        break
    case (true, false, _):
        // Skipped due to sampling - this is normal
        break
    case (false, _, let error?):
        // Actual error - log it
        logger.error("Trace failed: \(error)")
    default:
        break
    }
}
```

---

## Troubleshooting

### PerformanceObserver Not Working

1. Ensure WebView is using WKWebView (not UIWebView)
2. Check that JavaScript is enabled
3. Verify the page supports PerformanceObserver:
   ```javascript
   console.log(typeof PerformanceObserver);  // Should be "function"
   ```

### High Memory Usage

1. Reduce session duration
2. Increase sampling rate (fewer sessions)
3. Call `reset()` between sessions

### Traces Not Appearing

1. Check output directory permissions
2. Verify `TraceEmitter.emit()` is called
3. Check for errors in completion handler

### Frame Timing Inaccurate on macOS

macOS uses a timer-based fallback instead of CVDisplayLink. For more accurate timing:
1. Use iOS/tvOS for precise measurements
2. Accept ~1ms variance on macOS

---

## See Also

- [Adapter Selection Guide](../adapters/choosing-adapter.md)
- [Browser Setup Guide](../browsers/browser-setup.md)
- [render-debugger CLI Documentation](../../README.md)
