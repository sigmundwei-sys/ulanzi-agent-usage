# コントリビューションガイド

[English](../CONTRIBUTING.md) · [繁體中文](CONTRIBUTING.zh-TW.md) · 日本語 · [한국어](CONTRIBUTING.ko.md)

provider の API、CLI、dashboard 更新を含む Issue と Pull Request を歓迎します。

## Pull Request の前に

1. `npm ci --ignore-scripts --no-audit --no-fund`、`npm test`、`npm run check`、`npm run validate:manifest` を実行します。
2. `node_modules`、ローカル設定、token、cookie、log、provider アカウント export を含めないでください。
3. response 形式が変わった場合は parser fixture を追加または更新します。
4. provider 固有の credential と network code は、その provider adapter 内に置きます。
5. provider interface が公式、文書化済み、experimental のどれかを明記します。

Live smoke test は使い捨て、または redacted 環境で実行してください。credential の値を Issue や Pull Request に貼らないでください。
