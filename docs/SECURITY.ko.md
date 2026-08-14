# 보안 정책

[English](../SECURITY.md) · [繁體中文](SECURITY.zh-TW.md) · [日本語](SECURITY.ja.md) · 한국어

공개 Issue에 access token, session cookie, credential file, 비밀이 포함된 스크린샷 또는 전체 debug log를 올리지 마세요.

보안 문제가 의심되면 repository 공개 후 GitHub Security Advisories를 통해 maintainer에게 비공개로 연락하세요. provider, OS, plugin version, redacted 재현 절차를 포함하고 비밀 자체는 보내지 마세요.

이 plugin은 로컬 소프트웨어입니다. credential은 사용자의 컴퓨터에서 읽고 요청은 설정된 provider로 직접 전송됩니다. Cursor와 GitHub Copilot adapter는 비공개 endpoint를 사용하는 experimental 기능입니다. token이 노출되었을 가능성이 있으면 즉시 revoke하고 rotate하세요.
