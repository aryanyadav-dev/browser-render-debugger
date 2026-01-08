# CLI Commands Reference

## Commands

- [init](#init)
- [profile](#profile)
- [analyze](#analyze)
- [compare](#compare)
- [fix](#fix)
- [monitor](#monitor)
- [rules list](#rules-list)
- [rules validate](#rules-validate)

---

## init

Initialize a render-debugger workspace.

```bash
render-debugger init --browser-path <path> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-b, --browser-path <path>` | Path to Chromium-based browser (required) | - |
| `-f, --force` | Force reinitialization | `false` |

### Examples

```bash
render-debugger init --browser-path /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
render-debugger init --browser-path /usr/bin/chromium --force
```

---

## profile

Profile a web page under a specific scenario.

```bash
render-debugger profile --url <url> --scenario <scenario> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-u, --url <url>` | URL to profile (required) | - |
| `-s, --scenario <scenario>` | Scenario name (required) | - |
| `-b, --browser-path <path>` | Browser executable path | From config |
| `-d, --profile-duration <seconds>` | Profile duration | `15` |
| `--headless` | Run in headless mode | `true` |
| `--no-headless` | Run with visible window | - |
| `-f, --fps-target <fps>` | Target FPS | `60` |
| `-p, --cdp-port <port>` | CDP port | `9222` |
| `--cdp-host <host>` | CDP host | `localhost` |
| `--adapter <type>` | Adapter type | Auto-detect |
| `-o, --out <path>` | Output path | Auto-generated |
| `--sampling-rate <rate>` | Sampling rate (0.0-1.0) | `1.0` |
| `--admin-trigger` | Admin-only trigger mode | `false` |
| `--admin-token <token>` | Admin token | - |
| `--no-telemetry` | Disable telemetry | `true` |

### Examples

```bash
render-debugger profile --url "https://example.com" --scenario scroll-heavy
render-debugger profile --url "https://example.com" --scenario animation-heavy --no-headless
render-debugger profile --url "https://example.com" --scenario scroll-heavy --profile-duration 30 --fps-target 120
render-debugger profile --url "https://example.com" --scenario scroll-heavy --cdp-port 9223
```

---

## analyze

Analyze trace data offline.

```bash
render-debugger analyze <trace-file> --name <run-name> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --name <name>` | Analysis run name (required) | - |
| `-f, --fps-target <fps>` | Target FPS | `60` |
| `-j, --json <path>` | JSON report output path | - |
| `-o, --out <path>` | HTML report output path | - |
| `-v, --verbose` | Verbose output | `false` |
| `--no-color` | Disable colors | `false` |
| `-s, --source-maps <paths...>` | Source map files | - |
| `-e, --export-harness` | Export replay harness | `false` |
| `--harness-all` | Include all detections | `false` |

### Examples

```bash
render-debugger analyze trace.json --name "homepage-test"
render-debugger analyze trace.json --name "test-run" --json report.json --out report.html
render-debugger analyze trace.json --name "test-run" --source-maps dist/main.js.map
render-debugger analyze trace.json --name "test-run" --export-harness
```

---

## compare

Compare two trace summaries.

```bash
render-debugger compare <base-trace> <head-trace> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | JSON output | `false` |
| `--fail-on <severity>` | Fail on severity (info/warning/high/critical) | - |
| `-v, --verbose` | Verbose output | `false` |
| `--no-color` | Disable colors | `false` |

### Examples

```bash
render-debugger compare baseline.json current.json
render-debugger compare baseline.json current.json --json
render-debugger compare baseline.json current.json --fail-on high
```

---

## fix

Generate and optionally apply patches.

```bash
render-debugger fix <trace-file> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --dry-run` | Preview patches only | `true` |
| `-a, --auto-apply` | Apply patches (requires Git) | `false` |
| `-b, --backup` | Backup original files | `true` |
| `-g, --git-branch <branch>` | Git branch name | Auto-generated |
| `-m, --max-patches <count>` | Max patches to generate | `10` |
| `--lint-command <command>` | Lint command | `npm run lint` |
| `--test-command <command>` | Test command | `npm test` |
| `--no-lint` | Skip linting | `false` |
| `--no-tests` | Skip tests | `false` |

### Examples

```bash
render-debugger fix trace.json
render-debugger fix trace.json --dry-run
render-debugger fix trace.json --auto-apply
render-debugger fix trace.json --auto-apply --git-branch "perf/fix-layout"
render-debugger fix trace.json --auto-apply --max-patches 5
```

---

## monitor

Continuously monitor rendering performance.

```bash
render-debugger monitor --url <url> --scenario <scenario> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-u, --url <url>` | URL to monitor (required) | - |
| `-s, --scenario <scenario>` | Scenario name (required) | - |
| `-r, --rolling <seconds>` | Rolling window duration | `60` |
| `-a, --alert-cmd <command>` | Alert command | - |
| `-b, --browser-path <path>` | Browser path | From config |
| `-p, --cdp-port <port>` | CDP port | `9222` |
| `--cdp-host <host>` | CDP host | `localhost` |
| `--adapter <type>` | Adapter type | Auto-detect |

### Examples

```bash
render-debugger monitor --url "https://example.com" --scenario scroll-heavy
render-debugger monitor --url "https://example.com" --scenario scroll-heavy --rolling 120
render-debugger monitor --url "https://example.com" --scenario scroll-heavy --alert-cmd "notify-send"
```

---

## rules list

Display configured performance rules.

```bash
render-debugger rules list [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-j, --json` | JSON output | `false` |
| `-e, --enabled <enabled>` | Filter by enabled (true/false) | - |
| `-m, --metric <metric>` | Filter by metric | - |

### Examples

```bash
render-debugger rules list
render-debugger rules list --json
render-debugger rules list --enabled true
render-debugger rules list --metric p95_frame_time
```

---

## rules validate

Validate rules.yaml file.

```bash
render-debugger rules validate [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --file <path>` | Rules file path | `.render-debugger/rules.yaml` |
| `-s, --strict` | Treat warnings as errors | `false` |

### Examples

```bash
render-debugger rules validate
render-debugger rules validate --file ./custom-rules.yaml
render-debugger rules validate --strict
```

---

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 10 | CDP connection failed |
| 11 | Invalid URL |
| 12 | Harness crash |
| 13 | Browser validation failed |
| 14 | Scenario not found |
| 20 | Git required |
| 21 | Patch failed |
| 22 | Dirty working tree |
| 30 | Trace parse failed |
| 31 | Trace not found |
| 40 | Rule validation failed |
| 50 | Regression detected |
