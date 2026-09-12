import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { decryptV10Gcm, encryptV10Gcm } from "../plugins/grok-bot/scripts/lib/oscrypt.mjs";

test("v10 gcm roundtrip", () => {
  const key = randomBytes(32);
  const plain = Buffer.from(JSON.stringify({ baseUrl: "https://example.cursorvm.com", token: "x" }));
  const blob = encryptV10Gcm(plain, key);
  assert.equal(blob.subarray(0, 3).toString(), "v10");
  assert.equal(decryptV10Gcm(blob, key).toString(), plain.toString());
});
