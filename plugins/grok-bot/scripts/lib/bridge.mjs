import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { GrokBotError } from "./errors.mjs";
import { getTranscript, sendPrompt } from "./gateway.mjs";

const BRIDGE_RE = /GBOT_BRIDGE\b/;

export function grokHome(env = process.env, home = homedir()) {
  return env.GROK_HOME || join(home, ".grok");
}

export function inboxDir(env = process.env, home = homedir()) {
  return join(grokHome(env, home), "gbot-inbox");
}

export function parseBridgeLine(text) {
  const lines = String(text || "").split(/\r?\n/);
  let hit = null;
  for (const line of lines) {
    const idx = line.search(BRIDGE_RE);
    if (idx < 0) continue;
    hit = line.slice(idx);
  }
  if (!hit) return null;
  const rest = hit.replace(/^GBOT_BRIDGE\s+/, "");
  const out = {};
  for (const part of rest.split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (!out.job) return null;
  return out;
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function extractTar(tgz, dest) {
  mkdirSync(dest, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", tgz, "-C", dest], { encoding: "utf8" });
  if (tar.status !== 0) {
    throw new GrokBotError((tar.stderr || tar.stdout || "tar extract failed").trim(), "EXTRACT");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function buildPullPrompt({ job, nonce, path, inbox, git, script }) {
  const gitFlag = git ? " --git" : "";
  return [
    "Grok Build computer-bridge pull. Do this exactly. Do not redesign the site.",
    "Job: " + job,
    "Nonce: " + nonce,
    "Source path on YOUR Agent Computer: " + path,
    "Windows inbox (local-computer copy destination, same tool you used for Desktop): " + inbox,
    "",
    "1. Write the script below to /tmp/gbot-agent-bridge.mjs (overwrite).",
    "2. Run: node /tmp/gbot-agent-bridge.mjs pack --path " +
      path +
      " --job " +
      job +
      " --nonce " +
      nonce +
      " --inbox-dest " +
      JSON.stringify(inbox) +
      gitFlag,
    "3. If copied=0, copy /tmp/gbot-bridge/" +
      job +
      ".tgz and /tmp/gbot-bridge/" +
      job +
      ".json onto the Windows inbox path using local computer access.",
    "4. If local copy fails, re-run the pack command with --tunnel added and leave it running.",
    "5. Print the GBOT_BRIDGE line the script prints as its own message. Do not paraphrase.",
    "",
    "----- /tmp/gbot-agent-bridge.mjs -----",
    script,
    "----- end -----",
  ].join("\n");
}

export function loadAgentBridgeScript() {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "agent-bridge.mjs"), "utf8");
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new GrokBotError("tunnel download HTTP " + res.status, "TUNNEL");
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
}

export function inboxReady(tgz, sidecarPath) {
  if (!existsSync(tgz) || !existsSync(sidecarPath)) return false;
  let side;
  try {
    side = JSON.parse(readFileSync(sidecarPath, "utf8"));
  } catch {
    return false;
  }
  const want = Number(side.bytes);
  if (want > 0 && statSync(tgz).size < want) return false;
  return true;
}

export function verifySidecar(tgz, sidecarPath, job, nonce) {
  const side = JSON.parse(readFileSync(sidecarPath, "utf8"));
  if (side.job !== job) throw new GrokBotError("sidecar job mismatch", "INBOX");
  if (side.nonce && side.nonce !== nonce) throw new GrokBotError("sidecar nonce mismatch", "INBOX");
  const got = sha256File(tgz);
  if (side.sha256 && side.sha256 !== got) throw new GrokBotError("tarball sha256 mismatch", "INBOX");
  return { sidecar: side, sha256: got };
}

export async function waitForBridge({ session, botId, job, nonce, inbox, timeout = 90, poll = 2 }) {
  mkdirSync(inbox, { recursive: true });
  const tgz = join(inbox, job + ".tgz");
  const jsonPath = join(inbox, job + ".json");
  const deadline = Date.now() + timeout * 1000;
  let lastLine = null;
  while (Date.now() < deadline) {
    const tail = await getTranscript(session, botId, 80);
    for (const entry of tail.entries) {
      const parsed = parseBridgeLine(entry.text || "");
      if (parsed && parsed.job === job) lastLine = parsed;
    }
    if (lastLine && lastLine.nonce && lastLine.nonce !== nonce) {
      throw new GrokBotError("bridge nonce mismatch", "BRIDGE");
    }
    if (lastLine && lastLine.transport === "tunnel" && lastLine.url) {
      await downloadTo(lastLine.url, tgz);
      if (lastLine.sha256) {
        const got = sha256File(tgz);
        if (got !== lastLine.sha256) throw new GrokBotError("tunnel sha256 mismatch", "TUNNEL");
      }
      return { transport: "tunnel", tgz, sidecar: lastLine, sha256: sha256File(tgz) };
    }
    if (inboxReady(tgz, jsonPath)) {
      const v = verifySidecar(tgz, jsonPath, job, nonce);
      return { transport: "inbox", tgz, ...v };
    }
    await sleep(Math.max(0.4, poll) * 1000);
  }
  let trunc = "";
  if (existsSync(tgz) && existsSync(jsonPath)) {
    try {
      const side = JSON.parse(readFileSync(jsonPath, "utf8"));
      const got = statSync(tgz).size;
      if (side.bytes && got < Number(side.bytes)) {
        trunc = " inbox truncated " + got + "/" + side.bytes + " bytes";
      }
    } catch {
      /* ignore */
    }
  }
  throw new GrokBotError(
    "pull timed out waiting for inbox " +
      tgz +
      trunc +
      (lastLine ? " last=" + JSON.stringify(lastLine) : ""),
    "TIMEOUT",
  );
}

export async function pullFromBot(session, { name, path, dest, timeout = 180, git = false }) {
  if (!name || !path || !dest) throw new GrokBotError("pull requires name, path, dest", "PULL");
  if (/\s/.test(path)) throw new GrokBotError("path cannot contain spaces", "PULL");
  const job = randomUUID();
  const nonce = randomUUID();
  const inbox = inboxDir();
  mkdirSync(inbox, { recursive: true });
  const script = loadAgentBridgeScript();
  const prompt = buildPullPrompt({ job, nonce, path, inbox, git, script });
  const sent = await sendPrompt(session, name, prompt);
  if (sent.result?.accepted === false) throw new GrokBotError("sendPrompt was not accepted", "PULL");
  const got = await waitForBridge({
    session,
    botId: sent.target.id,
    job,
    nonce,
    inbox,
    timeout,
  });
  extractTar(got.tgz, dest);
  return {
    ok: true,
    transport: got.transport,
    dest,
    job,
    sha: got.sidecar?.sha || null,
    bytes: got.sidecar?.bytes ? Number(got.sidecar.bytes) : null,
    sha256: got.sha256,
    agent: sent.target.name,
  };
}

export function bridgeDoctor(env = process.env, home = homedir()) {
  const inbox = inboxDir(env, home);
  let writable = false;
  try {
    mkdirSync(inbox, { recursive: true });
    writable = true;
  } catch {
    writable = false;
  }
  return { inbox, writable };
}
