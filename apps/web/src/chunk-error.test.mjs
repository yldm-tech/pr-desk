import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { z } from "zod";
import { isChunkLoadError } from "./chunk-error.ts";

test("recognises the dynamic import failure of every browser", () => {
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://desk.test/assets/Overview-DcXl80tf.js")), true);
  assert.equal(isChunkLoadError(new Error("error loading dynamically imported module: https://desk.test/assets/Overview-DcXl80tf.js")), true);
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
});

test("leaves ordinary render failures to the fallback panel", () => {
  assert.equal(isChunkLoadError(new Error("boom")), false);
  assert.equal(isChunkLoadError(z.object({ total: z.number() }).safeParse({ total: "2" }).error), false);
  assert.equal(isChunkLoadError("Failed to fetch dynamically imported module"), false);
});
