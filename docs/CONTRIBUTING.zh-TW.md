# 貢獻指南

[English](../CONTRIBUTING.md) · 繁體中文 · [日本語](CONTRIBUTING.ja.md) · [한국어](CONTRIBUTING.ko.md)

歡迎提交 Issue 與 Pull Request，尤其是 provider 的 API、CLI 或 dashboard 更新。

## 提交 Pull Request 前

1. 執行 `npm ci --ignore-scripts --no-audit --no-fund`、`npm test`、`npm run check` 與 `npm run validate:manifest`。
2. 不要加入 `node_modules`、本機設定、token、cookie、log 或 provider 帳號匯出檔。
3. 如果 response 格式改變，請新增或更新 parser fixture。
4. Provider 專用的 credential 與 network code 應留在該 provider adapter 內。
5. 說明 provider 介面是官方、已文件化，或屬於 experimental。

Live smoke test 必須使用可拋棄或已遮罩的環境。絕對不要把 credential 值貼到 Issue 或 Pull Request。
