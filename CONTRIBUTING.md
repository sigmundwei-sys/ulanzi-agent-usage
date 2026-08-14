# Contributing

English · [繁體中文](docs/CONTRIBUTING.zh-TW.md) · [日本語](docs/CONTRIBUTING.ja.md) · [한국어](docs/CONTRIBUTING.ko.md)

Issues and pull requests are welcome, especially for provider changes caused
by upstream API or CLI updates.

Before opening a pull request:

1. Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`, `npm run check`, and `npm run validate:manifest`.
2. Do not include `node_modules`, local config, tokens, cookies, logs, or
   provider account exports.
3. Add or update a parser fixture when a response format changes.
4. Keep provider-specific credentials and network code inside that provider's
   adapter.
5. State whether the provider interface is official, documented, or
   experimental.

Live smoke tests must use a disposable or redacted environment. Never paste
credential values into an issue or pull request.
