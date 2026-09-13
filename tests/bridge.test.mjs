import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  buildPullPrompt,
  extractTar,
  inboxReady,
  parseBridgeLine,
  sha256File,
  verifySidecar,
} from "../plugins/grok-bot/scripts/lib/bridge.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentBridge = join(root, "plugins/grok-bot/scripts/agent-bridge.mjs");

test("parseBridgeLine reads last GBOT_BRIDGE", () => {
  const text = "noise\nGBOT_BRIDGE job=aaa nonce=n1 transport=inbox path=/workspace/x sha=none file=aaa.tgz sha256=abc\nmore";
  const p = parseBridgeLine(text);
  assert.equal(p.job, "aaa");
  assert.equal(p.transport, "inbox");
  assert.equal(p.path, "/workspace/x");
  assert.equal(parseBridgeLine("nope"), null);
});

test("parseBridgeLine rejects missing job", () => {
  assert.equal(parseBridgeLine("GBOT_BRIDGE transport=inbox"), null);
});

test("agent-bridge pack copies inbox and extract skips node_modules", () => {
  const src = mkdtempSync(join(tmpdir(), "gbot-src-"));
  const inbox = mkdtempSync(join(tmpdir(), "gbot-inbox-"));
  const dest = mkdtempSync(join(tmpdir(), "gbot-dest-"));
  writeFileSync(join(src, "hello.txt"), "hi\n");
  mkdirSync(join(src, "node_modules"));
  writeFileSync(join(src, "node_modules", "skip.js"), "nope\n");
  const job = randomUUID();
  const nonce = randomUUID();
  const packed = spawnSync(process.execPath, [agentBridge, "pack", "--path", src, "--job", job, "--nonce", nonce, "--inbox-dest", inbox], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const line = parseBridgeLine(packed.stdout);
  assert.ok(line);
  assert.equal(line.job, job);
  assert.equal(line.nonce, nonce);
  assert.equal(line.copied, "1");
  const tgz = join(inbox, job + ".tgz");
  const json = join(inbox, job + ".json");
  const v = verifySidecar(tgz, json, job, nonce);
  assert.equal(v.sha256, sha256File(tgz));
  extractTar(tgz, dest);
  assert.equal(readFileSync(join(dest, "hello.txt"), "utf8"), "hi\n");
  assert.throws(() => readFileSync(join(dest, "node_modules", "skip.js")));
});

test("inboxReady false while copy truncated", () => {
  const dir = mkdtempSync(join(tmpdir(), "gbot-trunc-"));
  const tgz = join(dir, "a.tgz");
  const json = join(dir, "a.json");
  writeFileSync(tgz, "short");
  writeFileSync(json, JSON.stringify({ job: "a", nonce: "n", bytes: 99999, sha256: "x" }));
  assert.equal(inboxReady(tgz, json), false);
  writeFileSync(json, JSON.stringify({ job: "a", nonce: "n", bytes: 5, sha256: "x" }));
  assert.equal(inboxReady(tgz, json), true);
});

test("verifySidecar rejects wrong hash", () => {
  const src = mkdtempSync(join(tmpdir(), "gbot-src-"));
  const inbox = mkdtempSync(join(tmpdir(), "gbot-inbox-"));
  writeFileSync(join(src, "a.txt"), "a\n");
  const job = randomUUID();
  const nonce = randomUUID();
  const packed = spawnSync(process.execPath, [agentBridge, "pack", "--path", src, "--job", job, "--nonce", nonce, "--inbox-dest", inbox], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const json = join(inbox, job + ".json");
  const side = JSON.parse(readFileSync(json, "utf8"));
  side.sha256 = "0".repeat(64);
  writeFileSync(json, JSON.stringify(side));
  assert.throws(() => verifySidecar(join(inbox, job + ".tgz"), json, job, nonce), /sha256/);
});

test("buildPullPrompt embeds job and script", () => {
  const prompt = buildPullPrompt({
    job: "job-1",
    nonce: "n-1",
    path: "/workspace/flux-hydration",
    inbox: "C:\\Users\\saibh\\.grok\\gbot-inbox",
    git: false,
    script: "console.log(1)\n",
  });
  assert.match(prompt, /Job: job-1/);
  assert.match(prompt, /Nonce: n-1/);
  assert.match(prompt, /\/workspace\/flux-hydration/);
  assert.match(prompt, /console\.log\(1\)/);
  assert.match(prompt, /GBOT_BRIDGE/);
});
