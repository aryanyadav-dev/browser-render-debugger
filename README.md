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
render-debugger profile --url "https://example.com" --scenario scroll-heavy

# Analyze the trace
render-debugger analyze .render-debugger/traces/<run>/trace.json --name "my-analysis"

# Compare traces for regressions
render-debugger compare baseline.json current.json --fail-on high

# Generate fixes
render-debugger fix trace.json --dry-run
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize workspace with config and sample scenarios |
| `profile` | Profile a web page under a specific scenario |
| `analyze` | Analyze trace data and generate reports |
| `compare` | Compare two traces for regressions |
| `fix` | Generate and optionally apply patches |
| `monitor` | Continuous performance monitoring |
| `rules list` | Display configured rules |
| `rules validate` | Validate rules configuration |

## Command Examples

### Profile
```bash
render-debugger profile \
  --url "https://example.com" \
  --scenario scroll-heavy \
  --profile-duration 30 \
  --fps-target 60 \
  --headless
```

### Analyze
```bash
# Terminal report
render-debugger analyze trace.json --name "homepage"

# JSON output
render-debugger analyze trace.json --json report.json

# HTML report
render-debugger analyze trace.json --out report.html
```

### Compare
```bash
render-debugger compare baseline.json current.json --fail-on high --json diff.json
```

### Fix
```bash
# Preview mode
render-debugger fix trace.json --dry-run

# Auto-apply with Git
render-debugger fix trace.json --auto-apply --git-branch perf/fixes
```

### Monitor
```bash
render-debugger monitor \
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
    render-debugger profile --url "$APP_URL" --scenario scroll-heavy --headless
    render-debugger analyze .render-debugger/traces/*/trace.json --json report.json
    render-debugger compare baseline.json .render-debugger/traces/*/trace.json --fail-on high
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
