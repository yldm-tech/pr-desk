import { afterEach, test } from "vite-plus/test";
import assert from "node:assert/strict";
import { isShortcutTarget, matchSequence } from "./shortcuts.ts";

// The guard reads only `closest` on the target and `querySelector` on the document, so a two-method stand-in is the whole DOM it needs.
const element = (matches) => ({ closest: (selector) => (matches && selector.split(",").some((part) => matches.includes(part)) ? {} : null) });
const withDocument = (openDialog) => {
  globalThis.document = { querySelector: () => (openDialog ? {} : null) };
};
const key = (target, extra = {}) => ({ key: "j", target, metaKey: false, ctrlKey: false, altKey: false, ...extra });

afterEach(() => {
  delete globalThis.document;
});

test("a plain key on the page is a shortcut", () => {
  withDocument(false);
  assert.equal(isShortcutTarget(key(element(null))), false);
});

test("a held modifier leaves the key to the browser", () => {
  withDocument(false);
  for (const modifier of ["metaKey", "ctrlKey", "altKey"]) assert.equal(isShortcutTarget(key(element(null), { [modifier]: true })), true, modifier);
});

test("typing in a field, a picker or a dialog is text, not a shortcut", () => {
  withDocument(false);
  for (const selector of ["input", "textarea", "select", "[contenteditable=true]", "[role=dialog]", "dialog", "[role=combobox]"]) assert.equal(isShortcutTarget(key(element([selector]))), true, selector);
});

test("an open dialog anywhere takes the keys from the page", () => {
  withDocument(true);
  assert.equal(isShortcutTarget(key(element(null))), true);
});

test("a sequence matches when its second key follows inside the window", () => {
  const first = matchSequence([], "g", 1000, ["g i", "g p"]);
  assert.equal(first.match, null);
  assert.deepEqual(first.buffer, [{ key: "g", at: 1000 }]);
  const second = matchSequence(first.buffer, "p", 1600, ["g i", "g p"]);
  assert.equal(second.match, "g p");
  assert.deepEqual(second.buffer, []);
});

test("a second key after the one-second window starts over", () => {
  const first = matchSequence([], "g", 1000, ["g i"]);
  const late = matchSequence(first.buffer, "i", 2001, ["g i"]);
  assert.equal(late.match, null);
  assert.deepEqual(late.buffer, []);
});

test("a stray key before the sequence does not block it", () => {
  const stray = matchSequence([], "x", 0, ["g i"]);
  assert.deepEqual(stray.buffer, []);
  const restarted = matchSequence([{ key: "g", at: 10 }], "g", 20, ["g i"]);
  assert.deepEqual(
    restarted.buffer.map((stroke) => stroke.key),
    ["g"],
  );
  assert.equal(matchSequence(restarted.buffer, "i", 30, ["g i"]).match, "g i");
});

test("a key that continues no binding is dropped", () => {
  const first = matchSequence([], "g", 0, ["g i"]);
  const wrong = matchSequence(first.buffer, "z", 100, ["g i"]);
  assert.equal(wrong.match, null);
  assert.deepEqual(wrong.buffer, []);
});
