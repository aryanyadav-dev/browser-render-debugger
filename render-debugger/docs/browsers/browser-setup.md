# Browser Setup Guide for render-debugger

This comprehensive guide covers setting up various browsers for use with `render-debugger`, including staging/development builds of Arc, Dia, Zen, and other Chromium-based browsers.

## Overview

`render-debugger` supports two adapter types:
- **Chromium CDP Adapter**: Full rendering pipeline access via Chrome DevTools Protocol
- **WebKit Native Adapter**: For WebKit-based browsers using the Swift SDK

This guide focuses on CDP setup for Chromium-based browsers.

## Supported Browsers

| Browser | CDP Support | Notes |
|---------|-------------|-------|
| Google Chrome | Full | All versions |
| Microsoft Edge | Full | All versions |
| Arc Browser | Full | Staging/dev builds recommended |
| Dia Browser | Full | Dev builds |
| Zen Browser | Full | All versions |
| Brave | Full | All versions |
| Opera | Full | All versions |
| Vivaldi | Full | All versions |

## Quick Start

### 1. Launch Browser with CDP Enabled

```bash
# Generic command
/path/to/browser --remote-debugging-port=9222
```

### 2. Initialize render-debugger

```bash
render-debugger init --browser-path /path/to/browser
```

### 3. Run a Profile

```bash
render-debugger profile --url "https://example.com" --scenario scroll-heavy --cdp-port 9222
```

---

## Browser-Specific Setup

### Google Chrome / Chromium

#### macOS
```bash
# Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Chromium
/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9222
```

#### Linux
```bash
google-chrome --remote-debugging-port=9222
# or
chromium-browser --remote-debugging-port=9222
```

#### Windows
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

---

### Microsoft Edge

#### macOS
```bash
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --remote-debugging-port=9222
```

#### Linux
```bash
microsoft-edge --remote-debugging-port=9222
```

#### Windows
```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
```

---

### Arc Browser

Arc is a Chromium-based browser with custom UI. For profiling, use staging or development builds.

#### Production Build (macOS)
```bash
/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222
```

#### Staging Build (macOS)
```bash
# Staging builds have better debugging support
/Applications/Arc\ Staging.app/Contents/MacOS/Arc --remote-debugging-port=9222
```

#### Development Build
```bash
# If you have access to Arc dev builds
/path/to/arc-dev/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222 \
  --enable-logging --v=1
```

#### Arc-Specific Flags
```bash
# Disable Arc's custom features for cleaner profiling
/Applications/Arc.app/Contents/MacOS/Arc \
  --remote-debugging-port=9222 \
  --disable-features=ArcBoosts,ArcSpaces \
  --no-first-run
```

---

### Dia Browser

Dia is a Swift-based browser. For CDP access, use development builds with Chromium rendering.

#### macOS
```bash
/Applications/Dia.app/Contents/MacOS/Dia --remote-debugging-port=9222
```

#### Development Build with Verbose Logging
```bash
/Applications/Dia\ Dev.app/Contents/MacOS/Dia \
  --remote-debugging-port=9222 \
  --enable-logging \
  --v=1
```

#### Using Native Adapter (Alternative)
For Dia's WebKit mode, use the native adapter instead:
```bash
render-debugger profile --url "https://example.com" \
  --adapter webkit-native \
  --trace-dir ~/Library/Application\ Support/Dia/traces
```

---

### Zen Browser

Zen is a Firefox-based browser but also offers Chromium builds.

#### macOS
```bash
/Applications/Zen\ Browser.app/Contents/MacOS/zen --remote-debugging-port=9222
```

#### Linux
```bash
zen-browser --remote-debugging-port=9222
```

#### Windows
```bash
"C:\Program Files\Zen Browser\zen.exe" --remote-debugging-port=9222
```

#### Zen Chromium Build
```bash
# If using Zen's Chromium variant
/Applications/Zen\ Chromium.app/Contents/MacOS/Zen --remote-debugging-port=9222
```

---

## Common Launch Flags

### Recommended Flags for Profiling

These flags reduce noise and improve profiling accuracy:

```bash
/path/to/browser \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-client-side-phishing-detection \
  --disable-default-apps \
  --disable-extensions \
  --disable-hang-monitor \
  --disable-popup-blocking \
  --disable-prompt-on-repost \
  --disable-sync \
  --disable-translate \
  --metrics-recording-only \
  --safebrowsing-disable-auto-update \
  --user-data-dir=/tmp/render-debugger-profile
```

### Headless Mode

For CI/CD environments:

```bash
/path/to/browser --remote-debugging-port=9222 --headless=new
```

### GPU Profiling Flags

For detailed GPU analysis:

```bash
/path/to/browser \
  --remote-debugging-port=9222 \
  --enable-gpu-benchmarking \
  --enable-thread-composting \
  --enable-impl-side-painting
```

### Memory Profiling Flags

```bash
/path/to/browser \
  --remote-debugging-port=9222 \
  --enable-precise-memory-info \
  --js-flags="--expose-gc"
```

---

## Port Configuration

### Default Port
The default CDP port is `9222`. You can use any available port:

```bash
# Use custom port
/path/to/browser --remote-debugging-port=9333

# Connect with render-debugger
render-debugger profile --url "..." --cdp-port 9333
```

### Multiple Browser Instances
Run multiple browsers on different ports:

```bash
# Chrome on 9222
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-1

# Edge on 9223
microsoft-edge --remote-debugging-port=9223 --user-data-dir=/tmp/edge-1

# Arc on 9224
/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9224
```

### Remote Debugging Over Network

```bash
# Allow connections from any IP (use with caution)
/path/to/browser --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0

# Connect from another machine
render-debugger profile --url "..." --cdp-host 192.168.1.100 --cdp-port 9222
```

**Security Warning**: Only use `--remote-debugging-address=0.0.0.0` on trusted networks.

---

## Troubleshooting

### Connection Issues

#### "Connection Refused" Error

1. **Verify browser is running with CDP enabled**:
   ```bash
   curl http://localhost:9222/json/version
   ```
   Should return JSON with browser info.

2. **Check port availability**:
   ```bash
   lsof -i :9222
   ```

3. **Restart browser with clean profile**:
   ```bash
   /path/to/browser --remote-debugging-port=9222 --user-data-dir=/tmp/clean-profile
   ```

#### "Port Already in Use" Error

```bash
# Find and kill process using the port
lsof -i :9222
kill -9 <PID>

# Or use a different port
/path/to/browser --remote-debugging-port=9223
```

#### Browser Crashes on Launch

1. **Use a fresh profile**:
   ```bash
   /path/to/browser --remote-debugging-port=9222 --user-data-dir=/tmp/fresh-profile
   ```

2. **Disable GPU acceleration** (if GPU issues):
   ```bash
   /path/to/browser --remote-debugging-port=9222 --disable-gpu
   ```

3. **Check for conflicting flags**:
   Some browser-specific flags may conflict. Start with minimal flags.

### Staging Build Issues

#### Arc Staging Not Connecting

1. Ensure you're using the correct binary path
2. Check if staging build requires special entitlements:
   ```bash
   codesign -d --entitlements :- /Applications/Arc\ Staging.app
   ```

#### Dia Dev Build Issues

1. Verify the build supports CDP (some WebKit-only builds don't)
2. Check console output for errors:
   ```bash
   /Applications/Dia\ Dev.app/Contents/MacOS/Dia --remote-debugging-port=9222 2>&1 | tee dia.log
   ```

### Performance Issues

#### Slow Trace Collection

1. Reduce trace categories:
   ```yaml
   # In .render-debugger/config.yaml
   profiling:
     traceCategories:
       - devtools.timeline
       - blink.user_timing
   ```

2. Shorten profile duration:
   ```bash
   render-debugger profile --url "..." --profile-duration 5
   ```

#### High Memory Usage

1. Use headless mode
2. Disable extensions
3. Use a fresh profile directory

---

## Configuration File

Set defaults in `.render-debugger/config.yaml`:

```yaml
version: "1.0"
browser:
  path: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  defaultCdpPort: 9222
  defaultHeadless: false
  launchTimeout: 30000

profiling:
  defaultDuration: 15
  defaultFpsTarget: 60
  traceCategories:
    - devtools.timeline
    - blink.user_timing
    - gpu
    - v8.execute
  bufferSize: 100000
```

---

## See Also

- [Adapter Selection Guide](../adapters/choosing-adapter.md) - Choose between CDP and Native adapters
- [Swift SDK Integration](../swift-sdk/integration-guide.md) - For WebKit-based browsers
- [Chrome DevTools Protocol Documentation](https://chromedevtools.github.io/devtools-protocol/)
