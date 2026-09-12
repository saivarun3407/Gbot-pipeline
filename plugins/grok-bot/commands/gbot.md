---
name: gbot
description: List, message, or create Grok Bot teammates from Grok Build
argument-hint: list|status|send <name> <prompt>|chat <name> <prompt>|create <name>| #<name> <prompt>
---

User arguments: $ARGUMENTS

This command talks to Grok Bot teammates via the grok-bot plugin MCP tools. Do not do the Bot's work in this session.

If `$ARGUMENTS` is empty, call `grok_bot_list`.

If `$ARGUMENTS` starts with `#`, call `grok_bot_chat` with `hash` set to the full argument string.

Otherwise parse the first token:

- `list` / `status` / `doctor` → matching MCP tool
- `send <name> <prompt>` → `grok_bot_send`
- `chat <name> <prompt>` or `call <name> <prompt>` → `grok_bot_chat`
- `transcript <name>` → `grok_bot_transcript`
- `create <name>` plus optional title/description from the rest → `grok_bot_create` only if they asked to create

Summarize JSON results. Never print tokens or gateway URLs. If `stillRunning` is true, say so.
