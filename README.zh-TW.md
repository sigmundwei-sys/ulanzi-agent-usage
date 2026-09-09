# Ulanzi Agent Usage

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ulanzi Studio 3.0.11+](https://img.shields.io/badge/Ulanzi%20Studio-3.0.11%2B-ff6f3c)](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · 繁體中文 · [日本語](README.ja.md) · [한국어](README.ko.md)

把 AI coding agent 的配額直接顯示在 Ulanzi Deck 上：Claude Code、Codex、Cursor、GitHub Copilot、Kiro、Antigravity、Grok 與 OpenCode Go。

![Ulanzi Agent Usage 動態預覽](docs/showcase.gif)

這個預覽會循環顯示 plugin 使用的配額圖示狀態；它是 repository 內的輕量展示，不代表特定使用者的 D200/D200H 實機錄影。

## Ulanzi D200H 實機展示

![Ulanzi D200H 實際畫面](docs/ulanzi-d200h-live.png)

這是維護者提供的 Ulanzi D200H 實際畫面。每位使用者看到的 provider、百分比
與重置時間會依自己的帳號狀態而不同。

> 本專案是獨立軟體，不是 Ulanzi、Anthropic、OpenAI、Cursor、GitHub、Amazon、Google、xAI 或 OpenCode 的官方產品。

## 特色

- **19 個可直接使用的 action**：rolling 5 小時、weekly、monthly、credit、completion 與產品細分視窗。
- **帳號匯入體驗受到 cockpit-tools 啟發**：每個 provider 使用自己的官方 CLI、API、dashboard 或明確設定的本機 helper。
- **故障保護顯示**：provider 暫時失敗時保留最後成功值並顯示 stale，不會誤顯示 `0%`。
- **本機優先的憑證界線**：token、cookie、帳號檔只留在使用者電腦，不會送到中央服務或寫進 Ulanzi settings。
- **多帳號設定**：Copilot、Kiro 等有多個本機 profile 時可在 property inspector 選擇。
- **跨平台 Node.js service**：支援 Windows 與 macOS，遵循官方 Ulanzi property-inspector 慣例。
- **GitHub-ready 封裝**：CI 檢查 manifest 與 parser fixture；版本 tag 會產生乾淨 ZIP 與 checksum。

## 支援的 provider

| Provider | Actions | 資料來源 | 狀態 |
| --- | --- | --- | --- |
| Claude Code | 5h、7d | Claude Code OAuth usage API 與本機 credential store | 穩定 |
| Codex | 5 小時、7 天、GPT-5.3-Codex-Spark 5 小時／每週 | 官方 Codex app-server limits 與 model-specific rateLimitsByLimitId | 有對應 bucket 時穩定 |
| Grok | 共用每週用量、GrokBuild | 官方 Grok CLI billing endpoint，使用本機 CLI 登入狀態 | 實驗性；需要先執行 grok login |
| Kiro | Credit usage | AWS Kiro usage API 與 AWS SSO cache | 穩定；需要 profile ARN |
| OpenCode Go | 5h、7d、本月 | Console server dashboard，helper cache 作 fallback | 穩定；需要本機設定 |
| Cursor | Billing cycle | Cursor dashboard read-only endpoint | Experimental |
| GitHub Copilot | Included credits、inline suggestions | Copilot entitlement endpoint | Experimental |
| Antigravity | Gemini / 3P 5h、7d | 官方 `agy` summary + `antigravity-usage` fallback | Experimental |

Experimental adapter 依賴上游格式，可能因 provider 更新而需要調整；啟用前請先閱讀對應設定說明。

## 安裝

### 先決條件

- Ulanzi Studio **3.0.11 以上**。
- Node.js **20 以上**；Ulanzi Studio 目前用 Node 20 執行 JavaScript plugin。
- 你要使用的每個 action 都必須先完成對應 CLI、帳號或 helper 登入。

### 從 GitHub Release 快速安裝

正式 repository 是 [sigmundwei-sys/ulanzi-agent-usage](https://github.com/sigmundwei-sys/ulanzi-agent-usage)；release workflow 會產生對應 ZIP。

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/sigmundwei-sys/ulanzi-agent-usage/main/tools/install.sh \
  | bash -s -- sigmundwei-sys/ulanzi-agent-usage
```

Windows PowerShell：

```powershell
$repo = 'sigmundwei-sys/ulanzi-agent-usage'
Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/tools/install.ps1" -OutFile "$env:TEMP\ulanzi-agent-install.ps1"
& "$env:TEMP\ulanzi-agent-install.ps1" -Repository $repo
```

安裝器會先驗證 release 的 SHA-256 檔案，並預設拒絕覆蓋既有 plugin；只有明確傳入 `--force` 或 `-Force` 才會覆蓋。若 Ulanzi Studio 使用自訂 plugin 目錄，可設定 `ULANZI_PLUGIN_DIR`。

### Homebrew + npm

本專案不會捏造不存在的 Homebrew formula 或 npm package。Homebrew 用來安裝支援的 Node runtime；npm 用來安裝 plugin 的本機相依套件。

```bash
brew install node@20
export PATH="$(brew --prefix node@20)/bin:$PATH"
git clone https://github.com/sigmundwei-sys/ulanzi-agent-usage.git ulanzi-agent-usage
cd ulanzi-agent-usage
npm ci --ignore-scripts --no-audit --no-fund
```

接著把 repository 目錄複製到 Ulanzi plugin 目錄，再重新啟動 Ulanzi Studio。

Windows 先決條件：

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
npm ci --ignore-scripts --no-audit --no-fund
```

### 手動安裝

1. 下載 repository 或 release ZIP。
2. 保持資料夾名稱完全為 `com.ulanzi.agentusage.ulanziPlugin`。
3. 複製到：
   - Windows：`%APPDATA%\Ulanzi\UlanziDeck\Plugins\`
   - macOS：`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`
4. 在 plugin 目錄執行 `npm ci --ignore-scripts --no-audit --no-fund`。
5. 重啟 Ulanzi Studio，把 action 拖到按鍵並完成 provider 設定。

## 官方 Ulanzi 識別名稱

本 plugin 遵循官方 SDK 命名：

- Package folder：`com.ulanzi.agentusage.ulanziPlugin`
- Main service UUID：`com.ulanzi.ulanzistudio.agentusage`
- Action UUID：`com.ulanzi.ulanzistudio.agentusage.<action>`
- Manifest state 使用 `Name` 與 `Image`。
- 所有 action 宣告 `Controllers: ["Keypad"]` 與 `Devices: []`。

這是從原 Claude-only package 遷移的 breaking change。Ulanzi Studio 會把它視為新的 plugin，既有按鍵需要重新指定 action。

參考：[UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)、[manifest reference](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/blob/main/manifest.md)。

## Provider 設定

### 一次性本機設定工具

若要像桌面帳號管理工具一樣直接點選匯入，請啟動本機 GUI 精靈。它會讀取
Cursor 的本機 `state.vscdb` 與 Kiro 的本機 profile，列出可辨識的帳號，按下
「匯入」即可，不需要複製剪貼簿內容或手動編輯 JSON：

```powershell
node tools/provider-setup/setup.mjs --gui
```

可先用 `node tools/provider-setup/setup.mjs --gui --dry-run` 預覽，不會寫入任何本機設定。

套件內附本機 setup helper。先從已登入的 `cursor.com` dashboard 複製
`WorkosCursorSessionToken` 值到剪貼簿，再在 plugin package 目錄執行：

```powershell
node tools/provider-setup/setup.mjs --all --cursor-clipboard --yes
```

Cursor 值只會寫入 Windows 使用者環境變數 `CURSOR_SESSION_TOKEN`；Kiro
則讀取本機 AWS SSO cache，並可從保留的舊備份搬移靜態 `profileArn`。Token
與 cookie 不會寫入 `config.json`、plugin 資料夾或輸出。帳號匯入流程的操作體驗
受到 `cockpit-tools` 啟發。可先加 `--dry-run` 做唯讀檢查，完成後請完全
退出並重新開啟 Ulanzi Studio 以載入最新 plugin 程式。Windows 上執行中的
plugin 也會在下一次 polling 重新讀取已保存的使用者環境變數。

### Claude Code

```bash
claude auth login
```

plugin 讀取 Claude Code 本機 credential store 並呼叫 OAuth usage endpoint，不需要另外建立 Anthropic API key。

### Codex

```bash
npm install --global @openai/codex
codex login
```

plugin 會啟動 `codex app-server`，讀取官方 rate-limit window。若 executable 不在 `PATH`，可設定 `CODEX_BIN` 或 `CODEX_APP_SERVER_JS`。

### Grok

使用 Grok action 前先執行 grok login。Grok Weekly Usage 顯示共用的每週用量；GrokBuild Usage 顯示同一個每週池內的產品用量。

### Kiro

Kiro 需要 profile ARN 與 AWS SSO cache。若 Kiro 已登入，可用上面的本機 GUI
自動偵測並匯入，不需要手動編輯 JSON；多帳號時可用 action property inspector 選擇 profile。

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

Cursor 目前沒有穩定的公開 usage API。Experimental adapter 使用本機 `WorkosCursorSessionToken`，建議使用環境變數：

```powershell
$env:CURSOR_SESSION_TOKEN = '<local-session-token>'
```

不要把 cookie 或 token 提交到 Git。

### GitHub Copilot

在 `config.json` 設定本機 token 或 profile；有多個帳號時可從 property inspector 選擇。

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

請自行安裝 optional helper：

```bash
npm install --global antigravity-usage
antigravity-usage quota --method auto --json
```

若要取得 Gemini 與 Claude/GPT 的完整 weekly 加五小時配額，還要安裝並登入官方 `agy` CLI。plugin 會自動尋找 `agy`（也可在 `providers.antigravity.agyBin` 指定路徑），讀取它的本機 loopback quota summary；`antigravity-usage` 作為五小時 fallback。plugin 不會在背景自動下載軟體。

### OpenCode Go

安裝固定版本 helper 並完成 workspace/cookie 設定：

```powershell
npm install --global --ignore-scripts --omit=optional --no-audit --no-fund '@slkiser/opencode-quota@4.6.1'
```

設定 `OPENCODE_GO_WORKSPACE_ID` 與 `OPENCODE_GO_AUTH_COOKIE`，或使用 helper 的本機 `opencode-go.json`。plugin 每輪直接讀 server dashboard，helper cache 只作短暫 fallback；cookie 絕對不要放進 repository。

## 設定與隱私

請從 [`config.example.json`](config.example.json) 複製範例；真正的 credential 應放在本機環境變數或本機設定檔，不能提交到 Git。

- Windows 預設：`%APPDATA%\Ulanzi\AgentUsage\config.json`
- macOS 預設：`~/Library/Application Support/Ulanzi/AgentUsage/config.json`
- 可用 `ULANZI_AGENT_USAGE_CONFIG` 覆寫。
- 沒有 telemetry、中央 proxy 或帳號伺服器。
- 對外請求直接送到被選 provider 的 endpoint。
- Cursor 與 Copilot 使用 experimental 未公開 endpoint，請自行評估 provider 條款並輪替外洩 token。

## 開發

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run validate:manifest
```

Parser test 使用 fixture，不需要真實 credential。Live smoke test 必須使用可拋棄的本機帳號，且輸出不可包含 token、cookie 或 credential file。

內含的 Ulanzi SDK 元件來自官方 HTML/Node SDK；請參閱 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 與 [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)。

## CI/CD 與 Release

- 每次 push 與 pull request 都會在 Node 20、22 執行 syntax、manifest、parser 與 dependency-install 檢查。
- 推送 `v3.0.1` 之類的 tag 後，workflow 會發布：
  - `com.ulanzi.agentusage.ulanziPlugin.zip`
  - `com.ulanzi.agentusage.ulanziPlugin.zip.sha256`
- ZIP 從 Git tree 產生，不包含 `node_modules`、本機 config、log 或 credential。

維護者可用：

```bash
git tag v3.0.1
git push origin v3.0.1
```

## 社群

- Provider 壞掉：開 [provider report](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=provider_report.yml)。
- 發現 bug：使用 [bug report](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=bug_report.yml)。
- 有功能想法：使用 [feature request](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=feature_request.yml)。
- 開 issue 前請移除 token、cookie、帳號匯出檔與含秘密的截圖。
- 如果這個 plugin 幫你節省時間，請在 GitHub 留下一顆 ⭐；Star 能幫助更多 Ulanzi 使用者找到它，也能協助決定 provider 維護優先順序。

貢獻方式請看 [`CONTRIBUTING.md`](CONTRIBUTING.md)；安全問題請依 [`SECURITY.md`](SECURITY.md) 私下回報，不要公開貼在 issue。

## 致謝與授權

最初的 Claude Code action 與 Ulanzi integration 延續自 [narlei/ulanzideck_claude](https://github.com/narlei/ulanzideck_claude)。帳號匯入體驗受到 [`cockpit-tools`](https://github.com/jlcodes99/cockpit-tools) 啟發。本專案加入 provider adapter、官方 Codex app-server usage 與本機設定。

本專案原始程式碼採 MIT；內含的 Ulanzi SDK 部分採 Apache-2.0。請參閱 [`LICENSE`](LICENSE)、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 與 [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)。
