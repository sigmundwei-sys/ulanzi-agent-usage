# 기여 가이드

[English](../CONTRIBUTING.md) · [繁體中文](CONTRIBUTING.zh-TW.md) · [日本語](CONTRIBUTING.ja.md) · 한국어

특히 provider의 API, CLI, dashboard 변경에 대한 Issue와 Pull Request를 환영합니다.

## Pull Request 전에

1. `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`, `npm run check`, `npm run validate:manifest`를 실행하세요.
2. `node_modules`, 로컬 설정, token, cookie, log, provider 계정 export를 포함하지 마세요.
3. response 형식이 바뀌면 parser fixture를 추가하거나 업데이트하세요.
4. provider별 credential과 network code는 해당 provider adapter 안에 두세요.
5. provider interface가 공식인지, 문서화되었는지, experimental인지 명시하세요.

Live smoke test는 폐기 가능한 환경 또는 redacted 환경에서 실행해야 합니다. credential 값을 Issue나 Pull Request에 올리지 마세요.
