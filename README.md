# render-debugger

A CLI tool for profiling Chromium-based browsers via CDP and identifying rendering bottlenecks with actionable fixes.

[![npm version](https://img.shields.io/npm/v/render-debugger.svg)](https://www.npmjs.com/package/render-debugger)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Interface                           │
├─────────────────────────────────────────────────────────────────┤
│  init │ profile │ analyze │ compare │ fix │ monitor │ rules    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                        Core Engine                              │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│   Recorder  │  Analyzer   │  Suggester  │   Patcher   │ Monitor │
│             │             │             │             │         │
│  • CDP      │  • Layout   │  • CSS      │  • Diff     │ • Roll  │
│  • Trace    │  • GPU      │  • JS       │  • Git      │ • Alert │
│  • Scenario │  • Tasks    │  • Native   │  • Apply    │ • Trend │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                     Browser Adapters                            │
├─────────────────────────────┬───────────────────────────────────┤
│     Chromium CDP Adapter    │      WebKit Native Adapter        │
│  (Chrome, Edge, Arc, Dia)   │    (Safari via Swift SDK)         │
└─────────────────────────────┴───────────────────────────────────┘
```

## Installation

```bash
npm install -g render-debugger
```

## Quick Start

```bash
# Initialize workspace
render-debugger init --browser-path /path/to/chrome

# Profile a page
render-debugger p --url "https://example.com" --scenario scroll-heavy

# Analyze (auto-detects latest trace)
render-debugger a

# Compare baseline against latest trace
render-debugger c baseline.json

# Generate fixes
render-debugger f
```

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `analyze [trace]` | `a` | Analyze trace (auto-detects latest if omitted) |
| `profile` | `p` | Profile a web page under a specific scenario |
| `compare <base> [head]` | `c` | Compare traces (uses latest for head if omitted) |
| `fix [trace]` | `f` | Generate and optionally apply patches |
| `monitor` | `m` | Continuous performance monitoring |
| `init` | - | Initialize workspace with config and scenarios |
| `rules list` | - | Display configured rules |
| `rules validate` | - | Validate rules configuration |

## Command Examples

### Analyze
```bash
# Auto-detect and analyze latest trace
render-debugger a

# Analyze specific trace
render-debugger a trace.json

# With custom name and JSON output
render-debugger a trace.json --name "homepage" --json report.json

# Generate HTML report
render-debugger a trace.json --out report.html
```

### Profile
```bash
# Basic profile
render-debugger p --url "https://example.com" --scenario scroll-heavy

# With options
render-debugger p \
  --url "https://example.com" \
  --scenario scroll-heavy \
  --profile-duration 30 \
  --fps-target 60 \
  --headless
```

### Compare
```bash
# Compare baseline against latest trace
render-debugger c baseline.json

# Compare two specific traces
render-debugger c baseline.json current.json

# Fail CI on high severity regressions
render-debugger c baseline.json --fail-on high --json diff.json
```

### Fix
```bash
# Preview fixes for latest trace
render-debugger f

# Preview fixes for specific trace
render-debugger f trace.json --dry-run

# Auto-apply with Git
render-debugger f --auto-apply --git-branch perf/fixes
```

### Monitor
```bash
# Basic monitoring
render-debugger m --url "https://example.com" --scenario scroll-heavy

# With rolling window and alerts
render-debugger m \
  --url "https://example.com" \
  --scenario scroll-heavy \
  --rolling 60 \
  --alert-cmd "notify-send 'Performance Alert'"
```

## CI/CD Integration

```yaml
# GitHub Actions
- name: Performance Check
  run: |
    npm install -g render-debugger
    render-debugger init --browser-path /usr/bin/chromium-browser
    render-debugger p --url "$APP_URL" --scenario scroll-heavy --headless
    render-debugger a --json report.json
    render-debugger c baseline.json --fail-on high
```

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1-9 | General errors |
| 10-19 | CDP/Browser errors |
| 20-29 | Git/Patch errors |
| 30-39 | Trace errors |
| 40-49 | Rule errors |
| 50-59 | CI threshold exceeded |

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: NestJS
- **Language**: TypeScript
- **CDP**: chrome-remote-interface
- **Testing**: Jest

## Browser Support

| Browser | Adapter | Method |
|---------|---------|--------|
| Chrome | CDP | Remote debugging |
| Edge | CDP | Remote debugging |
| Arc | CDP | Remote debugging |
| Safari | WebKit | Swift SDK |

## Requirements

- Node.js 18+
- npm 9+
- Chromium-based browser
- Git (for `--auto-apply`)

## Documentation

- [CLI Commands Reference](docs/CLI-COMMANDS.md)
- [Browser Setup](docs/browsers/browser-setup.md)
- [Swift SDK](docs/swift-sdk/integration-guide.md)

## License

MIT © Aryan Yadav
