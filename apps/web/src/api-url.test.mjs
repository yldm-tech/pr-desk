import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { resolveAPIURL } from "./api-url.ts";

test("development targets the API port every other default in the repo uses", () => {
  assert.equal(resolveAPIURL({ DEV: true }), "http://localhost:8080");
});
test("the built application calls its own origin", () => {
  assert.equal(resolveAPIURL({ DEV: false }), "");
});
test("an explicit API URL wins and never keeps a trailing slash", () => {
  assert.equal(resolveAPIURL({ DEV: true, VITE_API_URL: "http://localhost:8081" }), "http://localhost:8081");
  assert.equal(resolveAPIURL({ DEV: false, VITE_API_URL: "https://desk.test/" }), "https://desk.test");
});
