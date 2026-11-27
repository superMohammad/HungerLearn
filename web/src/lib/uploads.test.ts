import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadNumber } from "./uploads";

test("uploadNumber reads the upload count from the app's version id", () => {
  assert.equal(uploadNumber("v1"), 1);
  assert.equal(uploadNumber("v3"), 3);
  assert.equal(uploadNumber("v12"), 12);
});

test("uploadNumber rejects ids the app never creates, naming the id", () => {
  for (const bad of ["", "v0", "v01", "1", "V2", "v2a", "version-2", "v-1"]) {
    assert.throws(() => uploadNumber(bad), (e: unknown) => e instanceof RangeError && e.message.includes(JSON.stringify(bad)));
  }
});
