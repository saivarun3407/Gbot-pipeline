import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractMcpFrames } from "../plugins/grok-bot/scripts/lib/mcp.mjs";

const cli = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../plugins/grok-bot/scripts/gbot-pipeline.mjs",
);

test("extractMcpFrames reads NDJSON and Content-Length", () => {
  const nd = extractMcpFrames('{"id":1}\n{"id":2}\npartial');
  assert.deepEqual(nd.messages, ['{"id":1}', '{"id":2}']);
  assert.equal(nd.rest, "partial");
  const body = '{"id":3}';
  const lsp = "Content-Length: " + body.length + "\r\n\r\n" + body;
  const framed = extractMcpFrames(lsp);
  assert.deepEqual(framed.messages, [body]);
  assert.equal(framed.rest, "");
});

function startMcp() {
  const child = spawn(process.execPath, [cli, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  return child;
}

function readLine(stream, ms = 2500) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk;
      const i = buf.indexOf("\n");
      if (i >= 0) {
        cleanup();
        resolve(buf.slice(0, i).replace(/\r$/, ""));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for MCP line, buffered=" + JSON.stringify(buf.slice(0, 300))));
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
    };
    stream.on("data", onData);
  });
}

test("mcp process stays up and answers NDJSON initialize", async (t) => {
  const child = startMcp();
  t.after(() => {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  });

  const died = once(child, "exit").then(([code, signal]) => {
    throw new Error("mcp exited before handshake code=" + code + " signal=" + signal);
  });

  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "probe", version: "0" },
    },
  };
  child.stdin.write(JSON.stringify(init) + "\n");
  const line = await Promise.race([readLine(child.stdout), died]);
  assert.equal(line.startsWith("Content-Length:"), false, "Grok speaks NDJSON, not LSP Content-Length");
  const msg = JSON.parse(line);
  assert.equal(msg.id, 1);
  assert.equal(msg.result.serverInfo.name, "gbot-pipeline");
  assert.ok(msg.result.protocolVersion);

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  const listLine = await readLine(child.stdout);
  const list = JSON.parse(listLine);
  assert.ok(list.result.tools.some((tool) => tool.name === "grok_bot_chat"));

  child.stdin.end();
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
});
