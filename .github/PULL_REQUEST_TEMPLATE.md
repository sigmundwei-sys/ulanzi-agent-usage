## Summary

<!-- What changed, and why? Please keep provider-specific changes scoped to the relevant adapter. -->

## Validation

- [ ] `npm ci --ignore-scripts --no-audit --no-fund`
- [ ] `npm test`
- [ ] `npm run check`
- [ ] `npm run validate:manifest`
- [ ] Live smoke test was not needed, or was run with a disposable/redacted account

## Provider and API status

- Provider/action: <!-- e.g. Codex 5h, Kiro, OpenCode Go -->
- Interface: <!-- official / documented / experimental -->
- Upstream reference or release note: <!-- link if applicable -->

## Safety checklist

- [ ] No token, cookie, credential file, account export, or secret log is included.
- [ ] No generated `node_modules`, local config, deployment snapshot, or private URL is included.
- [ ] Documentation and localized README links were updated if the user-facing behavior changed.
