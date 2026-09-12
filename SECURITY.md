# Security

This tool decrypts the local Grok Bot desktop session (same user, same machine) or uses `CURSOR_ACCESS_TOKEN` you set.

- Do not log or commit `gateway-descriptor.json`, `sand-secrets.json`, `Local State`, or env tokens.
- CLI/MCP output redacts tokens, JWTs, and `cursorvm.com` / `cursor.sh` URLs.
- All Grok Bots on one Cursor account share one cloud computer.
- Unofficial API. Treat it like a password manager companion, not a public SaaS client.
