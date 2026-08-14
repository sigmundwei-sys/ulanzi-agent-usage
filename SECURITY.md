# Security policy

English · [繁體中文](docs/SECURITY.zh-TW.md) · [日本語](docs/SECURITY.ja.md) · [한국어](docs/SECURITY.ko.md)

Please do not open a public issue containing an access token, session cookie,
credential file, screenshot with secrets, or full debug log.

For a suspected security issue, contact the repository maintainer privately
through the GitHub Security Advisories channel once this repository is
published. Include the affected provider, operating system, plugin version,
and a redacted reproduction. Never send the secret itself.

The plugin is local software: credentials are read from the user's machine and
requests go directly to the configured provider. Cursor and GitHub Copilot
adapters use undocumented upstream endpoints and should be treated as
experimental. Revoke and rotate any token that may have been exposed.
