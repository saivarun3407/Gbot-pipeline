import assert from "node:assert/strict";
import test from "node:test";
import { redact, redactText } from "../plugins/grok-bot/scripts/lib/redact.mjs";

test("redacts jwt and bearer", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaa.bbbbbbbbbb";
  assert.equal(redactText("Bearer abcdef " + jwt).includes(jwt), false);
  assert.match(redactText("Bearer supersecret"), /\[redacted\]/);
});

test("redacts secret keys", () => {
  const out = redact({ token: "abc", gatewayToken: "xyz", name: "Reed" });
  assert.equal(out.token, "[redacted]");
  assert.equal(out.gatewayToken, "[redacted]");
  assert.equal(out.name, "Reed");
});

test("redacts cursorvm urls", () => {
  const s = redactText("see https://box.us8.cursorvm.com/api/listAgents");
  assert.equal(s.includes("cursorvm.com"), false);
});
