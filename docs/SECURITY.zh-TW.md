# 安全政策

[English](../SECURITY.md) · 繁體中文 · [日本語](SECURITY.ja.md) · [한국어](SECURITY.ko.md)

請不要在公開 Issue 放入 access token、session cookie、credential file、含秘密的截圖或完整 debug log。

若發現疑似安全問題，repository 發布後請透過 GitHub Security Advisories 私下聯絡維護者。請提供 provider、作業系統、plugin 版本與已遮罩的重現方式，不要傳送秘密本身。

本 plugin 是本機軟體：credential 從使用者電腦讀取，請求直接送到設定的 provider。Cursor 與 GitHub Copilot adapter 使用未公開 endpoint，應視為 experimental。若 token 可能外洩，請立即撤銷並輪替。
