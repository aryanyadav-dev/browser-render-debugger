# Chromium CDP Setup Guide

This guide explains how to launch Chromium-based browsers with remote debugging enabled for use with `render-debugger`.

## Supported Browsers

The Chromium CDP adapter supports any Chromium-based browser:

- **Google Chrome** / **Chromium**
- **Microsoft Edge**
- **Brave Browser**
- **Arc Browser** (staging/dev builds)
- **Dia Browser** (staging/dev builds)
- **Zen Browser**
- **Opera**
- **Vivaldi**

## Launching with Remote Debugging

### Basic Launch Command

To enable CDP (Chrome DevTools Protocol) access, launch your browser with the `--remote-debugging-port` flag:

```bash
# Chrome/Chromium (macOS)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Chrome/Chromium (Linux)
google-chrome --remote-debugging-port=9222

# Chrome/Chromium (Windows)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# Microsoft Edge (macOS)
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --remote-debugging-port=9222

# Brave (macOS)
/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser --remote-debugging-port=9222
```

### Recommended Launch Flags

For profiling, we recommend these additional flags to reduce noise:

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
  --safebrowsing-disable-auto-update
```

### Headless Mode

For CI/CD or automated testing, add the headless flag:

```bash
/path/to/browser --remote-debugging-port=9222 --headless=new
```

## Connecting to a Running Browser

### Using render-debugger

Once the browser is running with remote debugging enabled:

```bash
# Connect to default port (9222)
render-debugger profile --url "https://example.com" --scenario scroll-heavy --cdp-port 9222

# Connect to custom host and port
render-debugger profile --url "https://example.com" --scenario scroll-heavy \
  --cdp-host 192.168.1.100 --cdp-port 9222

# Explicitly specify the adapter
render-debugger profile --url "https://example.com" --scenario scroll-heavy \
  --adapter chromium-cdp --cdp-port 9222
```

### Verifying CDP Connection

You can verify CDP is working by visiting:

```
http://localhost:9222/json/version
```

This should return JSON with browser version information.

## Arc, Dia, and Zen Browser Setup

### Arc Browser (Staging/Dev Builds)

Arc staging builds support CDP. Launch with:

```bash
# macOS
/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-port=9222

# Or for staging builds
/Applications/Arc\ Staging.app/Contents/MacOS/Arc --remote-debugging-port=9222
```

### Dia Browser (Dev Builds)

```bash
# macOS
/Applications/Dia.app/Contents/MacOS/Dia --remote-debugging-port=9222
```

### Zen Browser

```bash
# macOS
/Applications/Zen\ Browser.app/Contents/MacOS/zen --remote-debugging-port=9222

# Linux
zen-browser --remote-debugging-port=9222

# Windows
"C:\Program Files\Zen Browser\zen.exe" --remote-debugging-port=9222
```

## Remote Debugging Over Network

To allow connections from other machines:

```bash
/path/to/browser --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0
```

Then connect from render-debugger:

```bash
render-debugger profile --url "https://example.com" --scenario scroll-heavy \
  --cdp-host <remote-ip> --cdp-port 9222
```

**Security Warning**: Only use `--remote-debugging-address=0.0.0.0` on trusted networks.

## Troubleshooting

### Port Already in Use

If you get "port already in use" errors:

```bash
# Find process using the port
lsof -i :9222

# Kill the process
kill -9 <PID>
```

Or use a different port:

```bash
/path/to/browser --remote-debugging-port=9223
render-debugger profile --url "..." --cdp-port 9223
```

### Connection Refused

1. Verify the browser is running with `--remote-debugging-port`
2. Check the port is correct
3. Ensure no firewall is blocking the connection
4. Try `http://localhost:9222/json/version` in another browser

### Browser Crashes on Launch

Try with a clean profile:

```bash
/path/to/browser --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile
```

## Configuration

You can set default CDP settings in `.render-debugger/config.yaml`:

```yaml
browser:
  path: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  defaultCdpPort: 9222
  defaultHeadless: true
  launchTimeout: 30000
```

## See Also

- [Chrome DevTools Protocol Documentation](https://chromedevtools.github.io/devtools-protocol/)
- [Puppeteer Connection Guide](https://pptr.dev/guides/connect-to-browser)
