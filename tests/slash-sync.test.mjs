import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  botCommandMarkdown,
  commandSlug,
  MANAGED_PREFIX,
  MANIFEST_NAME,
  MARKER,
  syncSlashCommands,
  uniqueSlugs,
} from "../plugins/grok-bot/scripts/lib/slash-sync.mjs";

test("commandSlug lowercases and hyphenates", () => {
  assert.equal(commandSlug("Fh Webdesigner"), "fh-webdesigner");
  assert.equal(commandSlug("Percent"), "percent");
  assert.equal(commandSlug("  Master, Demon, Chief of Staff  "), "master-demon-chief-of-staff");
  assert.equal(commandSlug(""), "bot");
});

test("uniqueSlugs avoids reserved create and collisions", () => {
  const rows = uniqueSlugs([
    { id: "aaaaaaaa-1111", name: "create" },
    { id: "bbbbbbbb-2222", name: "Percent" },
    { id: "cccccccc-3333", name: "percent" },
  ]);
  const slugs = rows.map((r) => r.slug);
  assert.ok(!slugs.includes("create"));
  assert.equal(new Set(slugs).size, 3);
  assert.ok(rows.every((r) => r.file.startsWith(MANAGED_PREFIX) && r.file.endsWith(".md")));
});

test("botCommandMarkdown carries exact name and marker", () => {
  const md = botCommandMarkdown(
    { name: 'Fh "CTO"', isGroup: false, isRunning: true, hasUnread: true },
    "fh-cto",
  );
  assert.ok(md.includes(MARKER));
  assert.ok(md.includes("name: gbot-fh-cto"));
  assert.ok(md.includes(JSON.stringify('Fh "CTO"')));
  assert.ok(md.includes("running"));
  assert.ok(md.includes("unread"));
});

test("syncSlashCommands writes, replaces, and removes stale managed files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gbot-slash-"));
  await writeFile(join(dir, "keep-me.md"), "user file\n", "utf8");

  const first = await syncSlashCommands(
    [
      { id: "1", name: "Percent", isGroup: false },
      { id: "2", name: "Fh Webdesigner", isGroup: false },
    ],
    { commandsDir: dir },
  );
  assert.deepEqual(first.files.sort(), ["gbot-fh-webdesigner.md", "gbot-percent.md"]);
  const percent = await readFile(join(dir, "gbot-percent.md"), "utf8");
  assert.ok(percent.includes(MARKER));
  assert.ok(percent.includes(JSON.stringify("Percent")));

  const second = await syncSlashCommands([{ id: "2", name: "Fh Webdesigner", isGroup: false }], {
    commandsDir: dir,
  });
  assert.deepEqual(second.files, ["gbot-fh-webdesigner.md"]);
  assert.deepEqual(second.removed, ["gbot-percent.md"]);
  await assert.rejects(readFile(join(dir, "gbot-percent.md"), "utf8"), /ENOENT/);
  const keep = await readFile(join(dir, "keep-me.md"), "utf8");
  assert.equal(keep, "user file\n");
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST_NAME), "utf8"));
  assert.deepEqual(manifest.files, ["gbot-fh-webdesigner.md"]);
});
