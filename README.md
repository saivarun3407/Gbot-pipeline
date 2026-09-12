# Gbot Pipeline

Call **Grok Bot** teammates from **Grok Build**. Type `#Researcher pull tickets` in the TUI; the named Bot on your Cursor account does the work.

Unofficial companion. Not affiliated with xAI or Cursor. The Grok Bot gateway is undocumented and can change.

## Install in Grok Build

Requires [Node.js 18+](https://nodejs.org/).

```bash
grok plugin marketplace add saivarun3407/Gbot-pipeline
grok plugin install grok-bot --trust
```

Then in Grok Build:

```
#researcher pull last week's tickets and cite sources
/gbot list
/gbot create expense-manager
```

## CLI

```bash
git clone https://github.com/saivarun3407/Gbot-pipeline.git
node plugins/grok-bot/scripts/gbot-pipeline.mjs doctor
node plugins/grok-bot/scripts/gbot-pipeline.mjs list
node plugins/grok-bot/scripts/gbot-pipeline.mjs chat Researcher "what are you waiting on?"
node plugins/grok-bot/scripts/gbot-pipeline.mjs "#Researcher draft a brief. do not send." --stream
```

Or `npm install -g github:saivarun3407/Gbot-pipeline` then `gbot-pipeline`.

## Auth

Bots live on the **Cursor** account, not `grok login`. First match wins:

1. `GROK_BOT_GATEWAY_URL` + `GROK_BOT_GATEWAY_TOKEN`
2. Grok Bot desktop app session on this machine (Windows / macOS / Linux)
3. `CURSOR_ACCESS_TOKEN` or `GROK_BOT_ACCESS_TOKEN` → `EnsureSandBox` (app does not need to be signed in here; the account must have opened Grok Bot at least once on some device)

`XAI_API_KEY` and `~/.grok/auth.json` cannot call Grok Bots.

## Safety

- Never prints tokens, gateway URLs, or OSCrypt material.
- All Bots share one cloud computer.
- Create/delete only when you ask.

## Develop

```bash
npm test
```
