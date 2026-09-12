import { GrokBotError, die } from "./errors.mjs";
import {
  accessStatus,
  createAgent,
  getTranscript,
  health,
  listAgents,
  sendPrompt,
  updateAgent,
} from "./gateway.mjs";
import { parseCallArgs, parseHash } from "./hash.mjs";
import { printJson, redact } from "./redact.mjs";
import { appPresent, connectSession, desktopStatus } from "./session.mjs";
import { chat } from "./stream.mjs";
import { serveMcp } from "./mcp.mjs";

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function takeBool(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

function refOf(args) {
  return takeFlag(args, "--id") || takeFlag(args, "--name") || args[0];
}

export async function doctor({ hook = false } = {}) {
  const status = desktopStatus();
  const out = {
    appPresent: appPresent(),
    signedIn: status?.signedIn ?? null,
    appVersion: status?.appVersion || null,
    source: null,
    ok: false,
  };
  try {
    const session = await connectSession();
    out.source = session.source;
    out.ok = true;
    if (!hook) {
      const bots = await listAgents(session);
      out.bots = bots.length;
      out.health = await health(session);
      const access = await accessStatus(session);
      if (access) out.access = access;
    }
  } catch (err) {
    out.ok = false;
    out.error = err.message;
  }
  if (hook) {
    const line = out.ok
      ? "Grok Bot pipeline: ready (source=" + out.source + "). Type #BotName to message a teammate."
      : "Grok Bot pipeline: not ready. " + (out.error || "Sign in or set CURSOR_ACCESS_TOKEN.");
    process.stdout.write(line + "\n");
    return 0;
  }
  printJson(out);
  return out.ok ? 0 : 1;
}

async function withSession(fn) {
  const session = await connectSession();
  return fn(session);
}

export async function main(argv) {
  const args = [...argv];
  const hook = takeBool(args, "--hook");
  let cmd = args.shift();
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(helpText());
    return 0;
  }
  if (cmd.startsWith("#")) {
    args.unshift(cmd);
    cmd = "call";
  }
  try {
    switch (cmd) {
      case "mcp":
        await serveMcp();
        return 0;
      case "doctor":
        return await doctor({ hook });
      case "status":
        return await doctor({ hook: false });
      case "list": {
        const full = takeBool(args, "--full");
        await withSession(async (session) => {
          const bots = await listAgents(session);
          printJson(
            bots.map((b) => ({
              id: b.id,
              name: b.name,
              title: b.title,
              description: full ? b.description : (b.description || "").slice(0, 180),
              isGroup: b.isGroup,
              isRunning: b.isRunning,
              hasUnread: b.hasUnread,
            })),
          );
        });
        return 0;
      }
      case "create": {
        const name = takeFlag(args, "--name") || args[0];
        const title = takeFlag(args, "--title") || "";
        const description = takeFlag(args, "--description") || "";
        const force = takeBool(args, "--force");
        if (!name) throw new GrokBotError("create requires --name");
        await withSession(async (session) => {
          if (!force) {
            const existing = (await listAgents(session)).filter(
              (b) => b.name.toLowerCase() === name.toLowerCase(),
            );
            if (existing.length) {
              throw new GrokBotError("A Grok Bot named " + JSON.stringify(name) + " already exists. Pass --force.");
            }
          }
          printJson(await createAgent(session, { name, title, description }));
        });
        return 0;
      }
      case "update": {
        const ref = refOf(args);
        if (!ref) throw new GrokBotError("update requires --name or --id");
        printJson(
          await withSession((session) =>
            updateAgent(session, ref, {
              name: takeFlag(args, "--rename"),
              title: takeFlag(args, "--title"),
              description: takeFlag(args, "--description"),
            }),
          ),
        );
        return 0;
      }
      case "send": {
        const id = takeFlag(args, "--id");
        const name = takeFlag(args, "--name");
        const promptFlag = takeFlag(args, "--prompt");
        const ref = id || name || args[0];
        const prompt = promptFlag || (id || name ? args.join(" ") : args.slice(1).join(" ")).trim();
        if (!ref || !prompt) throw new GrokBotError("send requires a bot and a prompt");
        const result = await withSession((session) => sendPrompt(session, ref, prompt));
        printJson({ accepted: result.result?.accepted !== false, agent: result.target });
        return 0;
      }
      case "transcript": {
        const ref = refOf(args);
        const limit = Number(takeFlag(args, "--limit") || 20);
        if (!ref) throw new GrokBotError("transcript requires a bot");
        printJson(await withSession((session) => getTranscript(session, ref, limit)));
        return 0;
      }
      case "chat":
      case "call": {
        const timeout = Number(takeFlag(args, "--timeout") || 90);
        const poll = Number(takeFlag(args, "--poll") || 2);
        const stream = takeBool(args, "--stream");
        const parsed = {
          name: takeFlag(args, "--name") || takeFlag(args, "--id"),
          prompt: takeFlag(args, "--prompt") || "",
        };
        if (!parsed.name || !parsed.prompt) {
          const fromArgs = parseCallArgs(args);
          if (fromArgs) {
            parsed.name = parsed.name || fromArgs.name;
            parsed.prompt = parsed.prompt || fromArgs.prompt;
          }
        }
        if (!parsed?.name || !parsed.prompt) throw new GrokBotError("chat/call requires a bot name and a prompt");
        const result = await withSession((session) =>
          chat(session, parsed.name, parsed.prompt, {
            timeout,
            poll,
            onEvent: stream ? (ev) => process.stdout.write(JSON.stringify(redact(ev)) + "\n") : undefined,
          }),
        );
        if (!stream) printJson(result);
        return result.stillRunning ? 2 : 0;
      }
      case "parse-hash": {
        printJson(parseHash(args.join(" ")));
        return 0;
      }
      default:
        throw new GrokBotError("Unknown command " + JSON.stringify(cmd));
    }
  } catch (err) {
    die(err instanceof GrokBotError ? err.message : err.message || String(err));
  }
}

function helpText() {
  return `gbot-pipeline — call Grok Bots from Grok Build

Commands:
  doctor              Check credentials (app session or CURSOR_ACCESS_TOKEN)
  list [--full]       List bots
  create --name NAME [--title T] [--description D]
  send NAME PROMPT    Fire-and-forget
  chat NAME PROMPT    Send and wait (alias: call, #NAME PROMPT)
  transcript NAME [--limit N]
  mcp                 MCP stdio server

Auth (first match):
  GROK_BOT_GATEWAY_URL + GROK_BOT_GATEWAY_TOKEN
  Grok Bot desktop session on this machine
  CURSOR_ACCESS_TOKEN / GROK_BOT_ACCESS_TOKEN  (account-level, app not required)

Unofficial. Not affiliated with xAI or Cursor.
`;
}
