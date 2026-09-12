// Migration aid, not part of the suite: it has its own config so the one CI runs
// never picks it up. It walks every rendered element and
// records its computed style, keyed by position in the tree rather than by class
// name — the names are what a Tailwind migration changes, the positions are not.
//
//   git worktree add ../base <commit> --detach
//   (there)  bunx playwright test -c playwright.tools.config.ts | sed -n 's/^SNAPSHOT //p' > before.json
//   (here)   bunx playwright test -c playwright.tools.config.ts | sed -n 's/^SNAPSHOT //p' > after.json
//   node tests/tools/compare.mjs before.json after.json
//
// Two differences are expected and cannot render: Tailwind's shadow utility adds
// transparent ring layers to box-shadow, and outline width and colour keep
// whatever the user agent had when outline-style is none. compare.mjs ignores them.
import { test, type Page } from "@playwright/test";
import { installFixtures } from "../browser/fixtures";

const PROPS = [
  "display",
  "position",
  "alignItems",
  "justifyContent",
  "flexDirection",
  "flexWrap",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "gap",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridColumn",
  "alignContent",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "margin",
  "padding",
  "top",
  "right",
  "bottom",
  "left",
  "backgroundColor",
  "backgroundImage",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRadius",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textDecorationLine",
  "textTransform",
  "textOverflow",
  "whiteSpace",
  "overflowWrap",
  "overflow",
  "opacity",
  "cursor",
  "zIndex",
  "boxShadow",
  "outlineStyle",
  "outlineWidth",
  "outlineColor",
  "outlineOffset",
  "userSelect",
  "listStyleType",
  "verticalAlign",
  "objectFit",
  "transform",
  "visibility",
];

// Every route worth a look, at the widths the stylesheets actually branch on.
const ROUTES = ["/#/", "/#/attention", "/#/pull-requests", "/#/repositories", "/#/about", "/#/settings", "/#/settings?tab=notifications", "/#/settings?tab=access"];
// Desktop, then each width a stylesheet or container query branches at.
const WIDTHS = [1280, 800, 760, 640, 400];

// Records every rendered element, keyed by its position in the tree.
async function collect(page: Page, props: string[], label: string) {
  return page.evaluate(
    ({ props, label }) => {
      const out: Record<string, Record<string, string>> = {};
      const pathOf = (el: Element) => {
        const parts: string[] = [];
        for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
          const siblings = node.parentElement ? [...node.parentElement.children] : [];
          parts.unshift(`${node.tagName.toLowerCase()}:${siblings.indexOf(node)}`);
        }
        return parts.join("/");
      };
      for (const el of document.querySelectorAll("body *")) {
        const style = getComputedStyle(el);
        if (style.display === "none" && el.tagName !== "DIALOG") continue;
        const record: Record<string, string> = {};
        for (const prop of props) record[prop] = style[prop as keyof CSSStyleDeclaration] as string;
        out[`${label}|${pathOf(el)}`] = record;
      }
      return out;
    },
    { props, label },
  );
}

test("capture computed styles", async ({ page }) => {
  test.setTimeout(0);
  await installFixtures(page);
  const snapshot: Record<string, Record<string, string>> = {};

  // Transitions are frozen before reading: a capture taken mid-transition
  // records an interpolated colour, which shows up as a difference between two
  // runs that render identically.
  const settle = async () => {
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
    await page.waitForTimeout(120);
  };

  const walk = async (label: string) => Object.assign(snapshot, await collect(page, PROPS, label));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await page.goto(route);
      await settle();
      await walk(`${width}${route}`);
    }
  }

  // Anything that only exists once opened is captured separately.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/");
  await settle();
  await page.locator("[aria-label='Language']").click();
  await page.waitForTimeout(200);
  await settle();
  await walk("1280/open-language");
  await page.keyboard.press("Escape");

  for (const width of [1280, 640, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/");
    await settle();
    const account = page.locator("[aria-label='Profile']").first();
    if (await account.count()) {
      await account.click();
      await page.waitForTimeout(250);
      await settle();
      await walk(`${width}/open-account`);
      await page.keyboard.press("Escape");
    }
  }

  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/pull-requests");
    const activity = page.getByTestId("pr-activity").first();
    if (await activity.count()) {
      await activity.click();
      await page.waitForTimeout(250);
      await settle();
      await walk(`${width}/open-activity`);
      await page.keyboard.press("Escape");
    }
  }

  console.log("SNAPSHOT " + JSON.stringify(snapshot));
});

// The welcome page only exists for a visitor who has not connected an account.
// It gets its own test so the page starts without a session rather than having
// to shed one it has already cached.
test("capture computed styles when disconnected", async ({ page }) => {
  test.setTimeout(0);
  await installFixtures(page);
  await page.route("**/api/v1/auth/status", (route) => route.fulfill({ json: { connected: false, username: "", sync_paused: false } }));
  const snapshot: Record<string, Record<string, string>> = {};
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/");
    await page
      .getByRole("link", { name: /Connect GitHub/ })
      .first()
      .waitFor();
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
    await page.waitForTimeout(120);
    Object.assign(snapshot, await collect(page, PROPS, `${width}/disconnected`));
  }
  console.log("SNAPSHOT " + JSON.stringify(snapshot));
});
