# Local provider setup helper

This is a one-time helper for the Ulanzi Agent Usage plugin. Its click-to-import
account flow was inspired by the account-management experience in
`cockpit-tools`.

## Click-to-import GUI

To import the currently logged-in accounts without copying tokens or editing
JSON, run the loopback wizard from the plugin package directory:

```powershell
node tools/provider-setup/setup.mjs --gui
```

The wizard reads Cursor's local `User/globalStorage/state.vscdb` and Kiro's
local `User/globalStorage/kiro.kiroagent/profile.json`. It shows only masked
account metadata in the browser. The raw Cursor value is written only to the
Windows user environment variable `CURSOR_SESSION_TOKEN`; Kiro writes only its
static profile ARN and AWS cache path to the local Agent Usage config. Run
`npm ci` in the package first so the bundled `sql.js` fallback is available on
Node 20; Node 22+ can use its built-in SQLite reader instead.

Use `--gui --dry-run` for a no-write preview. The wizard binds to `127.0.0.1`
only and closes automatically after 15 minutes.

From the plugin package directory:

```powershell
node tools/provider-setup/setup.mjs --all --cursor-clipboard --yes
```

Before running it, copy the Cursor `WorkosCursorSessionToken` value from the
logged-in `cursor.com` browser dashboard. The helper reads the clipboard and
saves the value as the Windows user environment variable
`CURSOR_SESSION_TOKEN`; it never puts the cookie in `config.json`, the plugin
folder, or its output.

For Kiro, the helper checks the AWS SSO auth cache and, when available, reads a
static `profileArn` from the newest retained legacy backup. The backup is only
used for this one-time migration; the running plugin talks directly to AWS.
The encrypted account key and account
contents stay in memory and are never copied or printed.

Useful options:

```text
--dry-run           inspect without changing the environment or config
--no-cursor        skip Cursor setup
--no-kiro          skip Kiro setup
--backup-root PATH use a specific legacy backup source directory
```

If multiple Kiro profiles are found but the current AWS auth cache cannot be
matched to exactly one of them, the helper refuses to write an ARN. This is
intentional: select the correct profile locally instead of pairing a token
with the wrong account.

After a successful setup, fully quit and reopen Ulanzi Studio so the plugin
process inherits the updated user environment and reloads its configuration.
