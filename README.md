# Ulanzi Agent Usage

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ulanzi Studio 3.0.11+](https://img.shields.io/badge/Ulanzi%20Studio-3.0.11%2B-ff6f3c)](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

Display the usage of your AI coding agents on an Ulanzi Deck: Claude Code, Codex, Cursor, GitHub Copilot, Kiro, Antigravity, and OpenCode Go.

![Animated Ulanzi Agent Usage preview](docs/showcase.gif)

The included preview cycles through the same quota icon states used by the plugin. It is a lightweight repository preview, not a recording of a specific user's D200/D200H screen.

## Real Ulanzi D200H preview

![Live Ulanzi D200H display](docs/ulanzi-d200h-live.png)

This is a real Ulanzi D200H capture shared by the maintainer. The providers,
percentages, and reset times shown on your device will vary with your accounts.

> This project is independent software. It is not an official product of Ulanzi, Anthropic, OpenAI, Cursor, GitHub, Amazon, Google, or OpenCode.

## Why this plugin

- **15 ready-to-use actions** for rolling 5-hour, weekly, monthly, credit, and completion windows.
- **Inspired account setup.** The click-to-import experience takes inspiration from `cockpit-tools`; each provider uses its own official CLI, API, dashboard, or explicitly configured local helper.
- **Stale-safe rendering.** When a provider is temporarily unavailable, the last good value stays visible with a stale indicator instead of becoming a misleading `0%`.
- **Local-first credentials.** Tokens, cookies, and account files stay on your computer; they are not sent to a central service or stored in Ulanzi settings.
- **Multi-account configuration** for providers that expose more than one local profile, including Copilot and Kiro.
- **Cross-platform Node.js service** for Windows and macOS, with official Ulanzi property-inspector conventions.
- **GitHub-ready packaging.** CI validates the manifest and parser fixtures; version tags publish a clean plugin ZIP and checksum.

## Supported providers

| Provider | Actions | Data source | Status |
| --- | --- | --- | --- |
| Claude Code | 5h, 7d | Claude Code OAuth usage API and local credential store | Stable |
| Codex | 5h, 7d | Official `codex app-server` `account/rateLimits/read` | Stable |
| Kiro | Credit usage | AWS Kiro usage API and AWS SSO cache | Stable; profile ARN required |
| OpenCode Go | 5h, 7d, month | Console server dashboard with helper-cache fallback | Stable; local setup required |
| Cursor | Billing cycle | Cursor dashboard read-only endpoint | Experimental |
| GitHub Copilot | Included credits, inline suggestions | Copilot entitlement endpoint | Experimental |
| Antigravity | Gemini / 3P 5h and 7d | official `agy` summary + `antigravity-usage` fallback | Experimental |

Experimental adapters depend on upstream formats that may change. See the provider setup notes before enabling them.

## Install

### Prerequisites

- Ulanzi Studio **3.0.11 or newer**.
- Node.js **20 or newer**. Ulanzi Studio currently runs JavaScript plugins on Node 20.
- An authenticated local CLI, provider account, or helper for each action you want to use.

### Fast install from a GitHub Release

The canonical repository is [sigmundwei-sys/ulanzi-agent-usage](https://github.com/sigmundwei-sys/ulanzi-agent-usage); the release workflow creates the referenced ZIP asset.

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/sigmundwei-sys/ulanzi-agent-usage/main/tools/install.sh \
  | bash -s -- sigmundwei-sys/ulanzi-agent-usage
```

Windows PowerShell:

```powershell
$repo = 'sigmundwei-sys/ulanzi-agent-usage'
Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/tools/install.ps1" -OutFile "$env:TEMP\ulanzi-agent-install.ps1"
& "$env:TEMP\ulanzi-agent-install.ps1" -Repository $repo
```

The installers verify the release SHA-256 asset and refuse to overwrite an existing plugin unless you explicitly pass `--force` or `-Force`. Set `ULANZI_PLUGIN_DIR` when Ulanzi Studio uses a custom plugin directory.

### Homebrew + npm

There is intentionally no fake Homebrew formula or npm package for the Ulanzi plugin. Homebrew installs the supported Node runtime; npm installs the plugin's local dependencies.

```bash
brew install node@20
export PATH="$(brew --prefix node@20)/bin:$PATH"
git clone https://github.com/sigmundwei-sys/ulanzi-agent-usage.git ulanzi-agent-usage
cd ulanzi-agent-usage
npm ci --ignore-scripts --no-audit --no-fund
```

Then copy the repository folder to your Ulanzi plugin directory and restart Ulanzi Studio.

Windows prerequisite:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
npm ci --ignore-scripts --no-audit --no-fund
```

### Manual installation

1. Download the repository or a release ZIP.
2. Keep the package folder name exactly `com.ulanzi.agentusage.ulanziPlugin`.
3. Copy it to:
   - Windows: `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`
   - macOS: `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`
4. Run `npm ci --ignore-scripts --no-audit --no-fund` inside the plugin folder.
5. Restart Ulanzi Studio, drag an action to a key, and complete its provider setup.

## Official Ulanzi identifiers

This plugin follows the official SDK naming rules:

- Package folder: `com.ulanzi.agentusage.ulanziPlugin`
- Main service UUID: `com.ulanzi.ulanzistudio.agentusage`
- Action UUIDs: `com.ulanzi.ulanzistudio.agentusage.<action>`
- Manifest state objects use `Name` and `Image`.
- All actions declare `Controllers: ["Keypad"]` and `Devices: []`.

The UUID migration is a breaking change from the original Claude-only package. Ulanzi Studio will see this as a new plugin, so existing keys must be assigned again.

Reference: [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK), [manifest reference](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/blob/main/manifest.md).

## Provider setup

### One-time local setup helper

For the click-to-import flow used by desktop account managers, run the local
loopback wizard. It detects the current Cursor account from Cursor's local
`state.vscdb` and the current Kiro profile from Kiro's local data, then lets you
click **Import**. No clipboard or manual JSON editing is required:

```powershell
node tools/provider-setup/setup.mjs --gui
```

Use `--gui --dry-run` to preview detected accounts without writing anything.

The package includes a local helper for the two providers that need account
metadata. From the plugin package directory, copy the Cursor
`WorkosCursorSessionToken` value to the clipboard, then run:

```powershell
node tools/provider-setup/setup.mjs --all --cursor-clipboard --yes
```

It stores the Cursor value only as the Windows user environment variable
`CURSOR_SESSION_TOKEN`. For Kiro it reuses the local AWS SSO cache and can
migrate a static profile ARN from a retained legacy backup. It never writes a
Token or cookie to `config.json`, the plugin folder, or its output. The account
import experience is inspired by `cockpit-tools`. Use `--dry-run` first
to inspect without changing anything. On Windows, a running plugin can also
re-read the persisted user variable on its next poll; fully restart Ulanzi
Studio after updating the plugin so the new code is loaded.

### Claude Code

```bash
claude auth login
```

The plugin reads Claude Code's local credential store and calls the OAuth usage endpoint. No separate Anthropic API key is required.

### Codex

```bash
npm install --global @openai/codex
codex login
```

The plugin starts `codex app-server` and reads the official rate-limit windows. If the executable is not on `PATH`, set `CODEX_BIN` or `CODEX_APP_SERVER_JS`.

### Kiro

Kiro requires a profile ARN and an AWS SSO cache. If Kiro is already signed in,
the local GUI wizard can detect both and import them without manual JSON; use
the action property inspector to select a configured profile when multiple accounts exist.

```json
{
  "providers": {
    "kiro": {
      "profiles": [
        {
          "id": "work",
          "label": "Work",
          "profileArn": "arn:aws:codewhisperer:us-east-1:...",
          "authFile": "~/.aws/sso/cache/kiro-auth-token.json"
        }
      ]
    }
  }
}
```

### Cursor

Cursor does not currently expose a stable public usage API. The experimental adapter uses a local `WorkosCursorSessionToken` value. Prefer an environment variable:

```powershell
$env:CURSOR_SESSION_TOKEN = '<local-session-token>'
```

Do not commit the cookie or token.

### GitHub Copilot

Set a local token or profile in `config.json`; the property inspector can select a profile when more than one account is configured.

```json
{
  "providers": {
    "copilot": {
      "tokenEnv": "GITHUB_COPILOT_TOKEN"
    }
  }
}
```

### Antigravity

Install the optional helper yourself:

```bash
npm install --global antigravity-usage
antigravity-usage quota --method auto --json
```

For the full Gemini and Claude/GPT weekly plus five-hour buckets, also install and sign in to the official `agy` CLI. The plugin auto-detects `agy` (or set `providers.antigravity.agyBin`) and reads its loopback quota summary; `antigravity-usage` remains the five-hour fallback. The plugin never downloads software in the background.

### OpenCode Go

Install the pinned helper and complete its local workspace/cookie setup:

```powershell
npm install --global --ignore-scripts --omit=optional --no-audit --no-fund '@slkiser/opencode-quota@4.6.1'
```

Configure `OPENCODE_GO_WORKSPACE_ID` and `OPENCODE_GO_AUTH_COOKIE`, or use the helper's local `opencode-go.json`. The plugin reads the server dashboard every polling cycle and uses the helper cache only as a short-lived fallback. Cookies never belong in this repository.

## Configuration and privacy

Copy [`config.example.json`](config.example.json) only as a template. Real credentials belong in local environment variables or the local config path, never in Git.

- Windows default: `%APPDATA%\Ulanzi\AgentUsage\config.json`
- macOS default: `~/Library/Application Support/Ulanzi/AgentUsage/config.json`
- Override with `ULANZI_AGENT_USAGE_CONFIG`.
- There is no telemetry, central proxy, or account server.
- Network requests go directly to the provider endpoints used by the selected adapter.
- Cursor and Copilot use experimental undocumented endpoints; evaluate provider terms and rotate any exposed token.

## Development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run validate:manifest
```

The parser tests use fixtures and do not require real credentials. Live smoke tests must run on a disposable local account and must not print tokens, cookies, or credential files.

The bundled SDK files are derived from the official Ulanzi HTML/Node SDK. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).

## Release and CI/CD

- Every push and pull request runs syntax, manifest, parser, and dependency-install checks on Node 20 and 22.
- Pushing a tag such as `v3.0.1` runs the same checks and publishes:
  - `com.ulanzi.agentusage.ulanziPlugin.zip`
  - `com.ulanzi.agentusage.ulanziPlugin.zip.sha256`
- The ZIP is generated from the Git tree, so it does not include `node_modules`, local config, logs, or credentials.

Maintainers can release with:

```bash
git tag v3.0.1
git push origin v3.0.1
```

## Community

- Found a provider break? Open a [provider report](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=provider_report.yml).
- Found a bug? Use the [bug report form](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=bug_report.yml).
- Have an idea? Use the [feature request form](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=feature_request.yml).
- Before opening an issue, remove tokens, cookies, account exports, and screenshots containing secrets.
- If this plugin saves you time, please leave a GitHub ⭐. Stars help other Ulanzi users discover the project and help prioritize provider maintenance.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for parser fixtures, provider boundaries, and pull-request expectations. Security reports belong in [`SECURITY.md`](SECURITY.md), not in a public issue.

## Credits and license

The initial Claude Code action and Ulanzi integration were based on [narlei/ulanzideck_claude](https://github.com/narlei/ulanzideck_claude). The account-import experience was inspired by [`cockpit-tools`](https://github.com/jlcodes99/cockpit-tools). This project adds provider adapters, official Codex app-server usage, and local configuration.

Original project source is MIT licensed. The vendored Ulanzi SDK portions are Apache-2.0. See [`LICENSE`](LICENSE), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).
