# セキュリティポリシー

[English](../SECURITY.md) · [繁體中文](SECURITY.zh-TW.md) · 日本語 · [한국어](SECURITY.ko.md)

公開 Issue に access token、session cookie、credential file、秘密を含むスクリーンショット、完全な debug log を投稿しないでください。

セキュリティ問題が疑われる場合は、repository 公開後に GitHub Security Advisories から非公開で maintainer へ連絡してください。provider、OS、plugin version、redacted な再現手順を含め、秘密そのものは送らないでください。

本 plugin はローカルソフトウェアです。credential はユーザーのコンピューターから読み取り、リクエストは設定した provider へ直接送信されます。Cursor と GitHub Copilot adapter は非公開 endpoint を使う experimental 機能です。token が漏えいした可能性があれば、直ちに revoke と rotate を行ってください。
