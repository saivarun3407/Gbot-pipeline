import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MANAGED_PREFIX = "gbot-";
export const MANIFEST_NAME = ".gbot-slash.json";
export const MARKER = "<!-- grok-bot-managed -->";

const RESERVED_SLUGS = new Set([
  "create",
  "list",
  "status",
  "doctor",
  "send",
  "chat",
  "call",
  "transcript",
  "update",
  "mcp",
  "pull",
]);

export function grokHome(env = process.env, home = homedir()) {
  return env.GROK_HOME || join(home, ".grok");
}

export function grokCommandsDir(env = process.env, home = homedir()) {
  return join(grokHome(env, home), "commands");
}

export function commandSlug(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "bot";
}

function yamlDoubleQuoted(value) {
  return (
    '"' +
    String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, " ")
      .slice(0, 80) +
    '"'
  );
}

function shortId(id) {
  return String(id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
}

export function uniqueSlugs(bots) {
  const used = new Set(RESERVED_SLUGS);
  const out = [];
  for (const bot of bots) {
    let slug = commandSlug(bot.name);
    if (used.has(slug)) {
      const extra = shortId(bot.id) || String(out.length + 1);
      slug = (commandSlug(bot.name + "-" + extra) || "bot-" + extra).slice(0, 48);
    }
    used.add(slug);
    out.push({ bot, slug, file: MANAGED_PREFIX + slug + ".md" });
  }
  return out;
}

export function botCommandMarkdown(bot, slug) {
  const kind = bot.isGroup ? "group" : "bot";
  const running = bot.isRunning ? " · running" : "";
  const unread = bot.hasUnread ? " · unread" : "";
  const desc = "Message " + (bot.name || slug) + running + unread;
  const exact = String(bot.name || "").replace(/\r?\n/g, " ");
  return (
    "---\n" +
    "name: " +
    MANAGED_PREFIX +
    slug +
    "\n" +
    "description: " +
    yamlDoubleQuoted(desc) +
    "\n" +
    "argument-hint: <prompt>\n" +
    "---\n\n" +
    MARKER +
    "\n\n" +
    "User arguments: $ARGUMENTS\n\n" +
    "Talk to Grok Bot teammates via grok-bot plugin MCP tools. Do not do the Bot's work in this session.\n\n" +
    "Target: " +
    kind +
    " named " +
    JSON.stringify(exact) +
    ".\n\n" +
    "If `$ARGUMENTS` is empty, call `grok_bot_transcript` for that name (limit 15) and summarize.\n\n" +
    "Otherwise call `grok_bot_chat` with `name` set to that exact name and `prompt` set to `$ARGUMENTS`.\n\n" +
    "Summarize JSON results. Never print tokens or gateway URLs. If `stillRunning` is true, say so.\n"
  );
}

async function readManifest(dir) {
  try {
    const raw = await readFile(join(dir, MANIFEST_NAME), "utf8");
    const data = JSON.parse(raw);
    const files = Array.isArray(data.files) ? data.files.filter((f) => typeof f === "string") : [];
    return { version: 1, files };
  } catch {
    return { version: 1, files: [] };
  }
}

async function writeAtomic(path, body) {
  const tmp = path + ".tmp-" + process.pid;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

export async function syncSlashCommands(bots, { commandsDir } = {}) {
  const dir = commandsDir || grokCommandsDir();
  await mkdir(dir, { recursive: true });
  const rows = uniqueSlugs(Array.isArray(bots) ? bots : []);
  const nextFiles = rows.map((r) => r.file);
  const prev = await readManifest(dir);
  const nextSet = new Set(nextFiles);

  for (const row of rows) {
    await writeAtomic(join(dir, row.file), botCommandMarkdown(row.bot, row.slug));
  }

  const stale = prev.files.filter((name) => !nextSet.has(name));
  for (const name of stale) {
    if (!name.startsWith(MANAGED_PREFIX) || !name.endsWith(".md") || name.includes("/") || name.includes("\\")) {
      continue;
    }
    try {
      await unlink(join(dir, name));
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
  }

  await writeAtomic(join(dir, MANIFEST_NAME), JSON.stringify({ version: 1, files: nextFiles }, null, 2) + "\n");
  return { dir, files: nextFiles, removed: stale };
}

export async function listManagedFiles(commandsDir) {
  const dir = commandsDir || grokCommandsDir();
  const names = await readdir(dir).catch(() => []);
  return names.filter((n) => n.startsWith(MANAGED_PREFIX) && n.endsWith(".md"));
}
