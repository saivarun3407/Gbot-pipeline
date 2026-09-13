#!/usr/bin/env node
// Runs on the Agent Computer (Linux). Node stdlib only.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function flag(name) {
  return process.argv.includes(name);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function formatBridgeLine(fields) {
  const parts = ["GBOT_BRIDGE"];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === "") continue;
    parts.push(k + "=" + String(v).replace(/\s+/g, ""));
  }
  return parts.join(" ");
}

function gitHead(dir) {
  const g = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  return g.status === 0 ? g.stdout.trim() : "";
}

function packTar(src, tgz, includeGit) {
  const excludes = ["node_modules", ".next", ".open-next", ".turbo", "dist"];
  if (!includeGit) excludes.push(".git");
  const args = ["-czf", tgz];
  for (const ex of excludes) args.push("--exclude=" + ex);
  args.push("-C", src, ".");
  const tar = spawnSync("tar", args, { encoding: "utf8" });
  if (tar.status !== 0) {
    throw new Error((tar.stderr || tar.stdout || "tar failed").trim());
  }
}

function tryCopyInbox(tgz, sidecarPath, inboxDest, job) {
  if (!inboxDest) return false;
  try {
    mkdirSync(inboxDest, { recursive: true });
    copyFileSync(tgz, join(inboxDest, job + ".tgz"));
    copyFileSync(sidecarPath, join(inboxDest, job + ".json"));
    return true;
  } catch {
    return false;
  }
}

function serveTarball(tgz, nonce) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url || "";
      if (req.method === "GET" && (url === "/" + nonce + ".tgz" || url === "/" + nonce)) {
        res.writeHead(200, { "content-type": "application/gzip" });
        createReadStream(tgz).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const cf = spawn("cloudflared", ["tunnel", "--url", "http://127.0.0.1:" + port], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buf = "";
      const onData = (chunk) => {
        buf += chunk;
        const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m) {
          cf.stdout.off("data", onData);
          cf.stderr.off("data", onData);
          resolve({ url: m[0] + "/" + nonce + ".tgz", server, cf });
        }
      };
      cf.stdout.on("data", onData);
      cf.stderr.on("data", onData);
      cf.on("error", () => {
        server.close();
        reject(new Error("cloudflared missing"));
      });
      cf.on("exit", (code) => {
        if (!buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)) {
          server.close();
          reject(new Error("cloudflared exited " + code));
        }
      });
    });
  });
}

async function pack() {
  const src = arg("--path");
  const job = arg("--job");
  const nonce = arg("--nonce") || job;
  const inboxDest = arg("--inbox-dest");
  const includeGit = flag("--git");
  const wantTunnel = flag("--tunnel");
  if (!src || !job) {
    process.stderr.write("usage: agent-bridge pack --path DIR --job ID [--nonce N] [--inbox-dest DIR] [--tunnel] [--git]\n");
    process.exit(2);
  }
  const abs = resolve(src);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    process.stderr.write("not a directory: " + abs + "\n");
    process.exit(2);
  }
  const outDir = join(tmpdir(), "gbot-bridge");
  mkdirSync(outDir, { recursive: true });
  const tgz = join(outDir, job + ".tgz");
  const sidecarPath = join(outDir, job + ".json");
  packTar(abs, tgz, includeGit);
  const hash = sha256File(tgz);
  const bytes = statSync(tgz).size;
  const sha = gitHead(abs) || "none";
  const sidecar = { job, nonce, path: abs, sha, bytes, sha256: hash, file: job + ".tgz" };
  writeFileSync(sidecarPath, JSON.stringify(sidecar) + "\n");
  const copied = tryCopyInbox(tgz, sidecarPath, inboxDest, job);
  let transport = copied ? "inbox" : "inbox";
  let url = "";
  const autoTunnel = wantTunnel || bytes > 512 * 1024;
  if (autoTunnel) {
    try {
      const tun = await serveTarball(tgz, nonce);
      transport = "tunnel";
      url = tun.url;
      writeSync(
        1,
        formatBridgeLine({ job, nonce, transport, path: abs, sha, url, file: job + ".tgz", sha256: hash, bytes }) + "\n",
      );
      await new Promise(() => {});
      return;
    } catch (err) {
      process.stderr.write(String(err.message || err) + "\n");
    }
  }
  writeSync(
    1,
    formatBridgeLine({
      job,
      nonce,
      transport,
      path: abs,
      sha,
      file: job + ".tgz",
      sha256: hash,
      bytes,
      copied: copied ? "1" : "0",
    }) + "\n",
  );
}

const cmd = process.argv[2];
if (cmd === "pack") {
  await pack();
} else {
  process.stderr.write("usage: agent-bridge pack ...\n");
  process.exit(2);
}
