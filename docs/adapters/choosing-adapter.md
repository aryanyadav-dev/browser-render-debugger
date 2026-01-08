# Choosing the Right Adapter

This guide helps you select the appropriate adapter for your browser profiling needs. `render-debugger` supports multiple adapters to accommodate different browser architectures and use cases.

## Quick Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│                  Which adapter should I use?                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │ Is your browser Chromium-based │
              │ (Chrome, Edge, Arc, Brave)?    │
              └───────────────────────────────┘
                     │              │
                    YES            NO
                     │              │
                     ▼              ▼
        ┌────────────────┐  ┌────────────────────┐
        │ Can you enable │  │ Is it a WebKit app │
        │ remote debug?  │  │ (iOS/macOS native)?│
        └────────────────┘  └────────────────────┘
           │         │           │          │
          YES       NO          YES        NO
           │         │           │          │
           ▼         ▼           ▼          ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ chromium │ │ webkit   │ │ webkit   │ │ Not yet  │
    │   -cdp   │ │ -native  │ │ -native  │ │ supported│
    └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

## Available Adapters

### 1. Chromium CDP Adapter (`chromium-cdp`)

The **recommended adapter** for Chromium-based browsers with full rendering pipeline visibility.

**Best for:**
- Google Chrome, Chromium
- Microsoft Edge
- Arc Browser (staging/dev builds)
- Dia Browser (Chromium mode)
- Zen Browser (Chromium builds)
- Brave, Opera, Vivaldi

**Use when:**
- You have access to browser launch flags
- You can enable `--remote-debugging-port`
- You need full rendering pipeline analysis
- You want GPU stall detection
- You need source map resolution

### 2. WebKit Native Adapter (`webkit-native`)

For WebKit-based browsers and iOS/macOS apps using the Swift SDK.

**Best for:**
- iOS apps with WKWebView
- macOS apps with WKWebView
- Safari (limited - requires Web Inspector)
- Dia Browser (WebKit mode)
- Custom WebKit browsers

**Use when:**
- You can't enable CDP (production apps)
- You're profiling iOS/macOS native apps
- You have the Swift SDK integrated
- You need production-safe profiling

---

## Capability Comparison

| Capability | chromium-cdp | webkit-native |
|------------|:------------:|:-------------:|
| Frame Timing | Full | Full |
| Dropped Frame Detection | Full | Full |
| Long Task Detection | Full | Partial |
| Layout Thrash Detection | Full | Limited |
| GPU Stall Detection | Full | No |
| Paint Event Tracking | Full | No |
| DOM Signals | Full | Basic |
| Source Map Resolution | Full | No |
| Live Monitoring | Full | Limited |
| Auto-Fix Patches | JS + CSS | JS + CSS only |
| Native Code Suggestions | N/A | Yes |
| Production Safe | Dev only | Yes |
| No Browser Modification | Requires flags | Yes |

### Legend
- Full support
- Partial/limited support
- Not supported

---

## Detailed Comparison

### Frame Timing & Dropped Frames

| Adapter | Method | Accuracy |
|---------|--------|----------|
| chromium-cdp | CDP Tracing API | ~0.1ms |
| webkit-native | CADisplayLink | ~1ms |

Both adapters provide accurate frame timing. CDP has slightly better precision due to direct access to the compositor.

### Long Task Detection

| Adapter | Detection Method | Details |
|---------|-----------------|---------|
| chromium-cdp | CDP + PerformanceObserver | Full call stack, source maps |
| webkit-native | os_signpost + JS bridge | Limited to marked tasks |

CDP provides automatic detection of all long tasks with full stack traces. Native adapter requires explicit task marking or PerformanceObserver injection.

### Layout & Paint Analysis

| Adapter | Layout Thrash | Paint Events | GPU Stalls |
|---------|--------------|--------------|------------|
| chromium-cdp | Full detection | Full | Full |
| webkit-native | DOM signals only | No | No |

CDP provides complete rendering pipeline visibility. Native adapter only receives high-level DOM signals without detailed paint/GPU information.

### Auto-Fix Capabilities

| Adapter | JS Patches | CSS Patches | Native Suggestions |
|---------|-----------|-------------|-------------------|
| chromium-cdp | Yes | Yes | N/A |
| webkit-native | Yes | Yes | Yes |

Both adapters can generate JS/CSS patches. Native adapter additionally provides Swift/native code suggestions (not auto-applied).

---

## Use Case Recommendations

### Web Development (Local)

**Recommended:** `chromium-cdp`

```bash
# Launch Chrome with debugging
google-chrome --remote-debugging-port=9222

# Profile
render-debugger profile --url "http://localhost:3000" \
  --adapter chromium-cdp \
  --cdp-port 9222
```

**Why:** Full visibility into rendering pipeline, source map support, complete auto-fix capabilities.

### CI/CD Pipeline

**Recommended:** `chromium-cdp` with headless mode

```bash
render-debugger profile --url "$TEST_URL" \
  --adapter chromium-cdp \
  --headless \
  --browser-path /usr/bin/chromium-browser
```

**Why:** Automated, reproducible, full analysis capabilities.

### iOS App Development

**Recommended:** `webkit-native` with Swift SDK

```swift
// In your iOS app
let session = TraceSession(config: .development)
session.start(name: "scroll-test") { result in
    // Trace saved to Documents/render-debugger-traces/
}
```

```bash
# On your Mac, analyze the trace
render-debugger analyze trace.json --adapter webkit-native
```

**Why:** Only option for iOS apps, production-safe, native code suggestions.

### Production Monitoring

**Recommended:** `webkit-native` with sampling

```swift
// Production config: 5% sampling, admin-only
let session = TraceSession(config: TraceSessionConfig(
    samplingRate: 0.05,
    triggerMode: .adminOnly,
    maxDurationSeconds: 10.0
))
```

**Why:** Low overhead, no browser modification required, sampling controls.

### Browser Extension Development

**Recommended:** `chromium-cdp`

```bash
# Launch with extension loaded
google-chrome --remote-debugging-port=9222 \
  --load-extension=/path/to/extension

render-debugger profile --url "chrome-extension://..." \
  --adapter chromium-cdp
```

**Why:** Full access to extension performance impact.

### Cross-Browser Testing

**Recommended:** Both adapters

```bash
# Test Chromium browsers
render-debugger profile --url "$URL" --adapter chromium-cdp --name "chrome"

# Test WebKit (via native app)
render-debugger analyze ios-trace.json --adapter webkit-native --name "ios"

# Compare
render-debugger compare chrome-trace.json ios-trace.json
```

**Why:** Comprehensive coverage across browser engines.

---

## Adapter Selection via CLI

### Explicit Selection

```bash
# Use CDP adapter
render-debugger profile --url "..." --adapter chromium-cdp

# Use native adapter
render-debugger analyze trace.json --adapter webkit-native
```

### Auto-Detection

When `--adapter` is not specified, render-debugger attempts auto-detection:

1. **For `profile` command:** Defaults to `chromium-cdp`
2. **For `analyze` command:** Detects from trace file format
3. **Browser path hints:** Checks browser binary name

```bash
# Auto-detects chromium-cdp for Chrome
render-debugger profile --url "..." --browser-path /usr/bin/google-chrome

# Auto-detects webkit-native for native trace format
render-debugger analyze native-trace.json
```

---

## Limitations by Adapter

### chromium-cdp Limitations

1. **Requires browser modification** - Must launch with `--remote-debugging-port`
2. **Not production-safe** - Debug port is a security risk
3. **No native code insight** - Can't see Swift/native performance
4. **Browser-specific** - Only works with Chromium-based browsers

### webkit-native Limitations

1. **No GPU analysis** - Can't detect GPU stalls or texture issues
2. **Limited paint visibility** - No paint event details
3. **No source maps** - Can't resolve minified code
4. **Requires SDK integration** - Must add Swift SDK to your app
5. **Manual task marking** - Long tasks need explicit instrumentation

---

## Migration Guide

### From CDP to Native

If you're moving from development (CDP) to production (native):

1. **Install Swift SDK** in your iOS/macOS app
2. **Instrument key interactions** with `LongTaskDetector`
3. **Configure sampling** for production (5-10%)
4. **Update CI** to analyze native traces

```bash
# Before (CDP)
render-debugger profile --url "..." --adapter chromium-cdp

# After (Native)
render-debugger analyze native-trace.json --adapter webkit-native
```

### Handling Capability Differences

Some detections won't be available with native adapter:

```bash
# CDP: Full analysis
render-debugger analyze cdp-trace.json
# Output: Layout thrash, GPU stalls, long tasks, paint issues

# Native: Partial analysis
render-debugger analyze native-trace.json --adapter webkit-native
# Output: Frame timing, long tasks, basic DOM signals
# Warning: GPU stall detection not available with webkit-native adapter
```

---

## Troubleshooting

### "Adapter not found"

```bash
# List available adapters
render-debugger adapters list

# Check adapter is registered
render-debugger adapters info chromium-cdp
```

### "Capability not supported"

Some analysis features require specific adapters:

```
⚠️ GPU stall detection requires chromium-cdp adapter
   Current adapter: webkit-native
   Skipping GPU stall analysis
```

**Solution:** Use CDP adapter for full analysis, or accept limited results with native adapter.

### "Connection failed"

For CDP adapter:
```bash
# Verify browser is running with debug port
curl http://localhost:9222/json/version

# Check port is correct
render-debugger profile --url "..." --cdp-port 9222
```

For native adapter:
```bash
# Verify trace directory exists
ls -la ~/Library/Application\ Support/MyApp/traces/

# Specify trace directory
render-debugger analyze --adapter webkit-native --trace-dir /path/to/traces
```

---

## See Also

- [Browser Setup Guide](../browsers/browser-setup.md) - CDP browser configuration
- [Swift SDK Integration](../swift-sdk/integration-guide.md) - Native adapter setup
- [CLI Commands Reference](../CLI-COMMANDS.md) - Full command documentation
