import assert from "node:assert/strict";
import test from "node:test";
import { resolveFromList } from "../plugins/grok-bot/scripts/lib/gateway.mjs";
import { handleMcp } from "../plugins/grok-bot/scripts/lib/mcp.mjs";
import { assertGatewayUrl } from "../plugins/grok-bot/scripts/lib/paths.mjs";

const bots = [
  { id: "aaa", name: "Researcher", title: "Scout" },
  { id: "bbb", name: "Writer", title: "Drafts" },
];

test("resolve by name and id", () => {
  assert.equal(resolveFromList(bots, "researcher").id, "aaa");
  assert.equal(resolveFromList(bots, "AAA").id, "aaa");
});

test("resolve hyphen as spaces", () => {
  const roster = [{ id: "c", name: "Fh CTO", title: "" }];
  assert.equal(resolveFromList(roster, "fh-cto").id, "c");
});

test("resolve missing", () => {
  assert.throws(() => resolveFromList(bots, "nope"), /No Grok Bot named/);
});

test("gateway url allowlist", () => {
  assert.match(assertGatewayUrl("https://foo.us8.cursorvm.com/"), /cursorvm\.com/);
  assert.throws(() => assertGatewayUrl("https://evil.example"), /allowed/);
  assert.throws(() => assertGatewayUrl("http://foo.cursorvm.com"), /https/);
});

test("mcp initialize and tools/list", () => {
  const init = handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.serverInfo.name, "gbot-pipeline");
  const list = handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(list.result.tools.some((t) => t.name === "grok_bot_chat"));
});
