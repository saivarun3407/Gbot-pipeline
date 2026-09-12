import assert from "node:assert/strict";
import test from "node:test";
import { parseCallArgs, parseHash } from "../plugins/grok-bot/scripts/lib/hash.mjs";

test("parseHash name and prompt", () => {
  assert.deepEqual(parseHash("#researcher pull tickets"), {
    name: "researcher",
    prompt: "pull tickets",
  });
});

test("parseHash hyphen name", () => {
  assert.equal(parseHash("#expense-manager draft the report").name, "expense-manager");
});

test("parseHash rejects empty", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("researcher go"), null);
});

test("parseCallArgs positional", () => {
  assert.deepEqual(parseCallArgs(["Writer", "turn that into a draft"]), {
    name: "Writer",
    prompt: "turn that into a draft",
  });
});

test("parseHash quoted name with spaces", () => {
  assert.deepEqual(parseHash('#"Fh CTO" draft a launch plan'), {
    name: "Fh CTO",
    prompt: "draft a launch plan",
  });
});
