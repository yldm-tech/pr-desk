import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { writeClipboard } from "./AccessSettings";

test("a clipboard write reports whether it happened", async () => {
  // Plain http is not a secure context, so navigator.clipboard is missing.
  assert.equal(await writeClipboard("value", undefined), false);
  const written = [];
  assert.equal(await writeClipboard("value", { writeText: (text) => Promise.resolve(written.push(text)) }), true);
  assert.deepEqual(written, ["value"]);
  assert.equal(await writeClipboard("value", { writeText: () => Promise.reject(new Error("denied")) }), false);
});
