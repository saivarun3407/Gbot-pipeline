---
name: grok-bot
description: >
  Call Grok Bot teammates from Grok Build. Use when the user types #BotName,
  runs /gbot, asks to list/create/message Grok Bots, or mentions Grok Bot
  teammates. Do not do the Bot's work in this session — send it to the named Bot.
---

# Grok Bot from Grok Build

Route work to Grok Bot teammates. This session is the dispatcher, not the worker.

## When the user types `#Name rest`

Names with spaces: `#"Fh CTO" rest` or `#fh-cto rest` (hyphens match spaces).

1. Call MCP tool `grok_bot_chat` with `hash` set to the full line, or `name` + `prompt`.
2. Summarize the returned `newEntries`. Do not invent a reply if `stillRunning` is true — say the Bot is still working and offer `grok_bot_transcript`.
3. Never print tokens, gateway URLs, or raw keychain/DPAPI material.

If MCP is unavailable, run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/gbot-pipeline.mjs" chat --name NAME --prompt "PROMPT"
```

## Other actions

| User intent | Tool |
|---|---|
| List teammates | `grok_bot_list` |
| Credentials / computer health | `grok_bot_doctor` |
| Fire-and-forget | `grok_bot_send` |
| Read recent messages | `grok_bot_transcript` |
| Create a teammate | `grok_bot_create` — only if they asked |
| Edit standing rules | `grok_bot_update` |

## Create rules

A new Bot needs a short unique `name`, a one-job `title`, and a `description` with outcome, sources, and what it must not do without approval. First task is draft-only unless the user says otherwise.

## Auth

Bots live on the **Cursor** account, not `grok login`. If doctor fails: sign into the Grok Bot app on this machine, or set `CURSOR_ACCESS_TOKEN` for the account that owns the Bots.

## Safety

- All Bots share one cloud computer. Names are not a security boundary.
- Do not send passwords, API keys, or 2FA. Tell the user to take over Agent Computer in the Grok Bot app.
- Do not approve local-computer access unless the user explicitly asked.
- Unofficial gateway. If a method fails, report the error. Do not invent new routes.
