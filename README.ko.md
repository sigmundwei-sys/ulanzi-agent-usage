# Ulanzi Agent Usage

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ulanzi Studio 3.0.11+](https://img.shields.io/badge/Ulanzi%20Studio-3.0.11%2B-ff6f3c)](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · 한국어

Claude Code, Codex, Cursor, GitHub Copilot, Kiro, Antigravity, Grok, OpenCode Go 등 AI 코딩 에이전트의 사용량을 Ulanzi Deck에 표시합니다.

![Ulanzi Agent Usage 애니메이션 미리보기](docs/showcase.gif)

이 미리보기는 plugin에서 사용하는 사용량 아이콘 상태를 순환해서 보여 줍니다. 특정 D200/D200H 실기기 화면을 녹화한 자료는 아닙니다.

## 실제 Ulanzi D200H 미리보기

![실제 Ulanzi D200H 화면](docs/ulanzi-d200h-live.png)

이 이미지는 유지 관리자가 공유한 실제 Ulanzi D200H 화면입니다. 표시되는 provider,
비율, 리셋 시간은 각 계정 상태에 따라 달라집니다.

> 이 프로젝트는 독립 소프트웨어이며 Ulanzi, Anthropic, OpenAI, Cursor, GitHub, Amazon, Google, xAI, OpenCode의 공식 제품이 아닙니다.

## 주요 기능

- **바로 사용할 수 있는 19개 action**: 5시간 rolling, weekly, monthly, credit, completion, product-specific 구간.
- **계정 가져오기 경험**: `cockpit-tools`의 계정 관리 흐름에서 영감을 받았으며, provider별 공식 CLI, API, dashboard 또는 명시적으로 설정한 로컬 helper 사용.
- **안전한 stale 표시**: 일시적인 조회 실패 시 마지막 성공 값을 유지하고 잘못된 `0%`를 표시하지 않음.
- **로컬 우선 인증 정보**: token, cookie, 계정 파일을 중앙 서비스나 Ulanzi settings로 보내지 않음.
- **다중 계정 설정**: Copilot과 Kiro의 여러 profile을 property inspector에서 선택 가능.
- **Windows / macOS 지원**: 공식 Ulanzi property-inspector 규칙을 따르는 Node.js service.
- **GitHub 배포 준비**: CI가 manifest와 parser fixture를 검사하고 tag에서 ZIP과 checksum을 공개.

## 지원 provider

| Provider | Actions | 데이터 출처 | 상태 |
| --- | --- | --- | --- |
| Claude Code | 5h, 7d | Claude Code OAuth usage API 및 로컬 credential store | Stable |
| Codex | 5h, 7d, GPT-5.3-Codex-Spark 5h/weekly | 공식 Codex app-server limits 및 model-specific rateLimitsByLimitId | bucket이 반환될 때 Stable |
| Grok | shared weekly pool, GrokBuild | 공식 Grok CLI billing endpoint 및 로컬 CLI 인증 | Experimental; grok login 필요 |
| Kiro | Credit usage | AWS Kiro usage API 및 AWS SSO cache | Stable; profile ARN 필요 |
| OpenCode Go | 5h, 7d, 월간 | Console server dashboard, helper cache fallback | Stable; 로컬 설정 필요 |
| Cursor | Billing cycle | Cursor dashboard read-only endpoint | Experimental |
| GitHub Copilot | Included credits, inline suggestions | Copilot entitlement endpoint | Experimental |
| Antigravity | Gemini / 3P 5h, 7d | 공식 `agy` summary + `antigravity-usage` fallback | Experimental |

Experimental adapter는 upstream 형식에 의존하므로 provider가 변경되면 수정이 필요할 수 있습니다.

## 설치

### 사전 요구 사항

- Ulanzi Studio **3.0.11 이상**.
- Node.js **20 이상**. Ulanzi Studio는 JavaScript plugin을 Node 20으로 실행합니다.
- 사용할 action에 해당하는 CLI, 계정 또는 helper 로그인.

### GitHub Release 빠른 설치

공식 repository는 [sigmundwei-sys/ulanzi-agent-usage](https://github.com/sigmundwei-sys/ulanzi-agent-usage)입니다. release workflow가 같은 ZIP 파일을 생성합니다.

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

설치기는 release SHA-256 파일을 먼저 검증하고 기본적으로 기존 plugin 덮어쓰기를 거부합니다. `--force` 또는 `-Force`를 명시한 경우에만 덮어씁니다. Ulanzi Studio의 plugin directory가 다르면 `ULANZI_PLUGIN_DIR`를 지정하세요.

### Homebrew + npm

존재하지 않는 Homebrew formula나 npm package를 만들지 않았습니다. Homebrew는 지원되는 Node runtime 설치에, npm은 plugin의 로컬 의존성 설치에 사용합니다.

```bash
brew install node@20
export PATH="$(brew --prefix node@20)/bin:$PATH"
git clone https://github.com/sigmundwei-sys/ulanzi-agent-usage.git ulanzi-agent-usage
cd ulanzi-agent-usage
npm ci --ignore-scripts --no-audit --no-fund
```

그 다음 repository folder를 Ulanzi plugin directory로 복사하고 Ulanzi Studio를 재시작합니다.

Windows 사전 설치:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
npm ci --ignore-scripts --no-audit --no-fund
```

### 수동 설치

1. repository 또는 release ZIP을 다운로드합니다.
2. 폴더 이름을 `com.ulanzi.agentusage.ulanziPlugin` 그대로 유지합니다.
3. 다음 위치로 복사합니다.
   - Windows: `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`
   - macOS: `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`
4. plugin folder에서 `npm ci --ignore-scripts --no-audit --no-fund`를 실행합니다.
5. Ulanzi Studio를 재시작하고 action을 키에 배치한 뒤 provider를 설정합니다.

## 공식 Ulanzi 식별자

공식 SDK의 명명 규칙을 따릅니다.

- Package folder: `com.ulanzi.agentusage.ulanziPlugin`
- Main service UUID: `com.ulanzi.ulanzistudio.agentusage`
- Action UUID: `com.ulanzi.ulanzistudio.agentusage.<action>`
- Manifest state는 `Name`과 `Image` 사용.
- 모든 action은 `Controllers: ["Keypad"]`와 `Devices: []` 선언.

기존 Claude-only package에서 UUID가 변경된 breaking change입니다. Ulanzi Studio에서는 새 plugin으로 인식하므로 기존 키에 action을 다시 배치해야 합니다.

참고: [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK), [manifest reference](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK/blob/main/manifest.md).

## Provider 설정

### 일회성 로컬 setup helper

데스크톱 계정 관리 도구처럼 클릭으로 가져오려면 로컬 GUI wizard를 실행하세요.
Cursor의 `state.vscdb`와 Kiro 로컬 profile을 자동으로 찾고 Import 버튼을 누르면 됩니다.
클립보드 복사나 JSON 수동 편집이 필요하지 않습니다.

```powershell
node tools/provider-setup/setup.mjs --gui
```

`--gui --dry-run`으로 파일을 변경하지 않고 검색 결과만 먼저 확인할 수 있습니다.

로그인된 `cursor.com` dashboard에서 `WorkosCursorSessionToken` 값을 클립보드에
복사한 다음 plugin package directory에서 실행합니다.

```powershell
node tools/provider-setup/setup.mjs --all --cursor-clipboard --yes
```

Cursor 값은 Windows 사용자 환경 변수 `CURSOR_SESSION_TOKEN`에만 저장됩니다.
Kiro는 로컬 AWS SSO cache를 사용하고, 보존된 이전 backup에서 정적 `profileArn`을
가져올 수 있습니다. Token이나 cookie는 `config.json`, plugin 폴더, 출력에 기록하지
않습니다. 먼저 `--dry-run`으로 확인할 수 있으며 완료 후 Ulanzi Studio를 완전히
재시작하여 최신 plugin 코드를 불러오세요. Windows에서는 실행 중인 plugin도 다음
polling 때 저장된 사용자 환경 변수를 다시 읽습니다.

### Claude Code

```bash
claude auth login
```

plugin은 Claude Code의 로컬 credential store를 읽고 OAuth usage endpoint를 호출합니다. 별도의 Anthropic API key는 필요하지 않습니다.

### Codex

```bash
npm install --global @openai/codex
codex login
```

plugin은 `codex app-server`를 시작하고 공식 rate-limit window를 읽습니다. executable이 `PATH`에 없으면 `CODEX_BIN` 또는 `CODEX_APP_SERVER_JS`를 설정하세요.

### Grok

Grok action을 사용하기 전에 grok login을 실행하세요. Grok Weekly Usage는 shared weekly pool, GrokBuild Usage는 그 안의 제품 사용량을 표시합니다.

### Kiro

profile ARN과 AWS SSO cache가 필요합니다. Kiro에 로그인되어 있으면 위의 로컬 GUI
wizard가 자동으로 찾아 가져옵니다. 여러 계정은 action property inspector에서 profile을 선택할 수 있습니다.

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

Cursor에는 현재 안정적인 공개 usage API가 없습니다. Experimental adapter는 로컬 `WorkosCursorSessionToken`을 사용합니다.

```powershell
$env:CURSOR_SESSION_TOKEN = '<local-session-token>'
```

cookie나 token을 Git에 commit하지 마세요.

### GitHub Copilot

`config.json`에 로컬 token 또는 profile을 설정합니다. 여러 계정은 property inspector에서 선택할 수 있습니다.

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

optional helper를 직접 설치합니다.

```bash
npm install --global antigravity-usage
antigravity-usage quota --method auto --json
```

Gemini 및 Claude/GPT의 weekly와 5시간 버킷을 모두 표시하려면 공식 `agy` CLI도 설치하고 로그인해야 합니다. plugin은 `agy`를 자동 검색하며(`providers.antigravity.agyBin`으로 경로 지정 가능), loopback quota summary를 읽습니다. `antigravity-usage`는 5시간 fallback으로 사용됩니다. 백그라운드에서 소프트웨어를 다운로드하지 않습니다.

### OpenCode Go

고정 버전 helper를 설치하고 workspace/cookie를 설정합니다.

```powershell
npm install --global --ignore-scripts --omit=optional --no-audit --no-fund '@slkiser/opencode-quota@4.6.1'
```

`OPENCODE_GO_WORKSPACE_ID`와 `OPENCODE_GO_AUTH_COOKIE`를 설정하거나 helper의 로컬 `opencode-go.json`을 사용합니다. plugin은 server dashboard를 직접 읽고 helper cache는 짧은 fallback으로만 사용합니다.

## 설정 및 개인정보

[`config.example.json`](config.example.json)은 템플릿으로만 사용하세요. 실제 credential은 로컬 환경 변수나 로컬 설정 파일에 두고 Git에 commit하지 마세요.

- Windows 기본값: `%APPDATA%\Ulanzi\AgentUsage\config.json`
- macOS 기본값: `~/Library/Application Support/Ulanzi/AgentUsage/config.json`
- `ULANZI_AGENT_USAGE_CONFIG`로 변경 가능.
- telemetry, 중앙 proxy, 계정 서버가 없습니다.
- 요청은 선택한 provider endpoint로 직접 전송됩니다.
- Cursor와 Copilot은 experimental 비공개 endpoint를 사용하므로 provider 약관과 token 취급을 확인하세요.

## 개발

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run validate:manifest
```

Parser test는 fixture를 사용하므로 실제 credential이 필요하지 않습니다. Live smoke test는 폐기 가능한 계정으로 실행하고 token, cookie, credential file을 출력하지 마세요.

포함된 Ulanzi SDK 부분은 공식 HTML/Node SDK를 기반으로 합니다. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)와 [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)를 확인하세요.

## CI/CD 및 Release

- 모든 push와 pull request에서 Node 20, 22로 syntax, manifest, parser, dependency-install을 검사합니다.
- `v3.0.1` 같은 tag를 push하면 다음 파일을 공개합니다.
  - `com.ulanzi.agentusage.ulanziPlugin.zip`
  - `com.ulanzi.agentusage.ulanziPlugin.zip.sha256`
- ZIP은 Git tree에서 생성되므로 `node_modules`, 로컬 config, log, credential을 포함하지 않습니다.

```bash
git tag v3.0.1
git push origin v3.0.1
```

## 커뮤니티

- provider 변경 신고: [provider report](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=provider_report.yml)
- bug 신고: [bug report](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=bug_report.yml)
- 기능 제안: [feature request](https://github.com/sigmundwei-sys/ulanzi-agent-usage/issues/new?template=feature_request.yml)
- issue를 열기 전에 token, cookie, 계정 export, 비밀이 포함된 스크린샷을 제거하세요.
- 도움이 되었다면 GitHub에 ⭐를 남겨 주세요. Star는 다른 Ulanzi 사용자가 프로젝트를 찾는 데 도움이 되고 provider 유지보수 우선순위에도 도움이 됩니다.

기여 방법은 [`CONTRIBUTING.md`](CONTRIBUTING.md), 보안 문제는 [`SECURITY.md`](SECURITY.md)를 참고하세요. 비밀이 포함된 내용을 공개 issue에 올리지 마세요.

## Credits 및 License

초기 Claude Code action과 Ulanzi integration은 [narlei/ulanzideck_claude](https://github.com/narlei/ulanzideck_claude)를 기반으로 합니다. 계정 가져오기 경험은 [`cockpit-tools`](https://github.com/jlcodes99/cockpit-tools)에서 영감을 받았습니다. 이 프로젝트는 provider adapter, 공식 Codex app-server usage, 로컬 설정을 추가합니다.

프로젝트 소스 코드는 MIT이며 포함된 Ulanzi SDK 부분은 Apache-2.0입니다. [`LICENSE`](LICENSE), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)를 참고하세요.
