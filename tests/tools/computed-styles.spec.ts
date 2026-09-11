// Migration aid, not part of the suite: playwright.config points at tests/browser,
// so this only runs when named explicitly. It records the computed styles of
// chosen elements at several widths so a stylesheet change can be compared
// against the state before it:
//
//   git worktree add ../base HEAD --detach
//   bunx playwright test tests/tools/computed-styles.spec.ts | sed -n 's/^SNAPSHOT //p' > before.json
//   (repeat on the branch, then diff the two files)
//
// Two differences are expected and harmless: Tailwind's shadow utility adds
// transparent ring layers to box-shadow, and outline width and colour keep
// whatever the user agent had when outline-style is none.
import { test } from "@playwright/test";

const PROPS = [
  "display",
  "alignItems",
  "justifyContent",
  "gap",
  "minHeight",
  "height",
  "width",
  "minWidth",
  "maxWidth",
  "maxHeight",
  "padding",
  "margin",
  "backgroundColor",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderRadius",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "whiteSpace",
  "cursor",
  "flexShrink",
  "flex",
  "zIndex",
  "boxShadow",
  "outlineWidth",
  "outlineStyle",
  "outlineColor",
  "outlineOffset",
  "userSelect",
  "overflow",
  "textOverflow",
  "textAlign",
  "position",
  "inset",
  "overflowWrap",
];

test("capture computed styles", async ({ page }) => {
  const snapshot: Record<string, Record<string, string>> = {};
  const grab = async (key: string, selector: string) => {
    const found = await page.evaluate(
      ({ selector, PROPS }) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const c = getComputedStyle(el);
        return Object.fromEntries(PROPS.map((p) => [p, c[p as keyof CSSStyleDeclaration] as string]));
      },
      { selector, PROPS },
    );
    if (found) snapshot[key] = found;
  };

  for (const width of [1280, 800, 640, 480, 400]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/#/");
    await grab(`language-trigger@${width}`, "[aria-label='Language']");
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/");
  await page.locator("[aria-label='Language']").click();
  await page.waitForTimeout(200);
  await grab("language-menu", "[data-radix-popper-content-wrapper] > *");
  await grab("language-option", "[role='option']");
  await grab("language-option-checked", "[role='option'][data-state='checked']");
  await page.keyboard.press("Escape");

  await page.goto("/#/attention");
  await grab("repository-select", "[aria-label='Filter by repository']");

  // Printed rather than written: this directory is type-checked without node
  // types, and a marker line is easy for a shell to pick out of the reporter.
  console.log("SNAPSHOT " + JSON.stringify(snapshot));
});
