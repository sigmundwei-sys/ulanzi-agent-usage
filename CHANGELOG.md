# Changelog

## 3.0.1 - 2026-08-14

- Fixed Cursor setup on Windows when Ulanzi Studio was started before the user
  environment variable was imported; the provider can re-read the persisted
  user variable on the next polling cycle.
- Added local Cursor `state.vscdb` account import with the required local
  session-token composition and masked GUI status.
- Added local Kiro profile discovery and click-to-import setup flow.
- Added public-repository `.gitignore` rules and pinned the bundled Ulanzi
  SDK's `ws` metadata to the tested version.
- Updated the English, Traditional Chinese, Japanese, and Korean setup notes.

## 3.0.0

- First release line with provider adapters and local account setup flow.
