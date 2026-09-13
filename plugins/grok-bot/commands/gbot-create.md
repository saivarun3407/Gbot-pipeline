---
name: gbot-create
description: Create a Grok Bot teammate
argument-hint: <name> [title/description]
---

User arguments: $ARGUMENTS

This command talks to Grok Bot teammates via the grok-bot plugin MCP tools. Do not do the Bot's work in this session.

The user asked to create a teammate. Call `grok_bot_create` only because they asked.

A new Bot needs a short unique `name`, a one-job `title`, and a `description` with outcome, sources, and what it must not do without approval. First task is draft-only unless the user says otherwise.

If `$ARGUMENTS` is empty, ask for name, title, and description, then create.

If `$ARGUMENTS` is present, parse the first token as `name` and the rest as title/description, then create.

Summarize JSON results. Never print tokens or gateway URLs.
After create, teammate rows in `/gbot` refresh on the next session or Plugins-tab `r`.
