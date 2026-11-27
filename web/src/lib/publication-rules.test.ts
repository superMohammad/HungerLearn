import assert from "node:assert/strict";
import { test } from "node:test";
import { canPublishWithFlags, initialItemState } from "./publication-rules";

test("a generated item with no flags is verified; any flag makes it a draft", () => {
  assert.deepEqual(initialItemState("ok", []), { flags: [], status: "verified" });
  assert.deepEqual(initialItemState("ok", ["quote_not_found"]), { flags: ["quote_not_found"], status: "draft" });
});

test("a needs_human package adds the needs_human flag to every item, once", () => {
  assert.deepEqual(initialItemState("needs_human", []), { flags: ["needs_human"], status: "draft" });
  assert.deepEqual(initialItemState("needs_human", ["needs_human", "judge_unsupported"]), {
    flags: ["needs_human", "judge_unsupported"],
    status: "draft",
  });
});

test("today a trainer may approve and publish an item despite its flags (no deterministic gate yet)", () => {
  assert.equal(canPublishWithFlags([]), true);
  assert.equal(canPublishWithFlags(["quote_not_found", "judge_unsupported"]), true);
});
