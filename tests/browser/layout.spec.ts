import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installFixtures, ROUTES, STRUCTURAL_ROUTES } from "./fixtures";

// The layout matrix. Every test in this file runs once per project in playwright.config.ts and nowhere else — the behavioural suite is excluded from these projects by `testIgnore`, so nothing here costs the other spec a second run.
//
// None of the five sweeps below asserts a pixel value, and that is deliberate: a test that pins geometry fails on every restyle and teaches nothing, while a test that asserts a property the design has to hold at *any* width survives a redesign and still catches a band that stopped being reachable.

// Edge projects only walk the routes whose layout changes band; the device projects walk everything. Declared as a skip inside the test rather than as a collection-time filter because a project's metadata is only readable from inside a test.
const routesFor = (info: TestInfo) => (info.project.metadata?.routes === "structural" ? STRUCTURAL_ROUTES : ROUTES);
const isCoarse = (info: TestInfo) => Boolean(info.project.use.hasTouch);

// Renders a route and waits for it to stop moving: the loading skeletons have to be gone, because a skeleton's geometry is a placeholder's and not the content's; the web fonts have to be resolved, because a fallback font measures differently; and transitions have to be frozen, because a reading taken mid-transition is an interpolated value that differs between two runs of the same page.
async function open(page: Page, route: string) {
  await page.goto(route);
  await page.waitForFunction(() => !document.querySelector(".react-loading-skeleton"));
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(80);
}

// (a) Clipped overflow. The assertion this replaces was `documentElement.scrollWidth > innerWidth`, which only sees overflow that reaches the document scroller; anything an `overflow: hidden` ancestor cuts off — and the pull-request table is wrapped in one — is unreachable, has no scrollbar, and passed. `auto`/`scroll` are excluded because a scroller is a design decision (the nav strip, the year tabs, the filter pills) while a clip is not, and an element that declares `text-overflow: ellipsis` or a line clamp is excluded because it is announcing the truncation rather than hiding it.
async function clippedElements(page: Page) {
  return page.evaluate(() => {
    const report: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (!["hidden", "clip"].includes(style.overflowX)) continue;
      if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") continue;
      // `sr-only` is the one place in the codebase that clips on purpose, and it is `clip-path: inset(50%)` over a 1px box. Its padding survives, so the box measures 24px wide rather than 1px on the table header — the clip path, not the width, is what identifies it.
      if (style.clipPath !== "none" || el.clientWidth <= 1) continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const name = el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? String(el.className).slice(0, 60);
      report.push(`${el.tagName.toLowerCase()}[${name}] ${el.scrollWidth}px of content in a ${el.clientWidth}px box`);
    }
    return report;
  });
}

// (b) Tap targets, measured in one pass rather than one round trip per control because a route can hold eighty of them. The floor is 44px, which is the figure the whole `pointer-coarse:min-h-11` convention is built on.
// Two exclusions, both about what a target *is* rather than about which ones currently fail. `display: inline` cannot carry a min-height at all, so sizing such a link means reflowing the prose around it. And an anchor with no padding, no border and no min-height of its own is a bare run of text: its box is its line box, the target is the words, and WCAG 2.5.8 exempts exactly that case ("the size is constrained by the line-height of non-target text"). A padded link, an icon link or anything with a control role is not exempt and is held to the full 44px.
// Anything translated off the top-left is skipped too: the skip link sits at `translateY(-160%)` until it takes focus, which makes it a keyboard affordance rather than a tap target.
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const report: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, summary, a[href], [role="tab"], [role="button"], select')) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.display === "inline" || style.visibility === "hidden" || style.pointerEvents === "none") continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.closest('[aria-hidden="true"]') || el.closest("[hidden]")) continue;
      const chrome = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce((total, side) => total + parseFloat(style[side as "paddingTop"]), 0);
      const unsizedTextLink = el.tagName === "A" && el.getAttribute("role") === null && chrome === 0 && (style.minHeight === "auto" || parseFloat(style.minHeight) === 0);
      if (unsizedTextLink) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.right <= 0) continue;
      // Half a pixel of tolerance: a 44px floor laid out on a fractional grid measures 43.99, which is a rounding artefact and not a control anyone can miss.
      if (Math.min(rect.width, rect.height) >= 43.5) continue;
      const name = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 32);
      report.push(`${el.tagName.toLowerCase()}[${name}] ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`);
    }
    return report;
  });
}

// (c) Control font size. iOS Safari zooms the page in whenever a focused text control computes under 16px and, because index.html carries no `maximum-scale`, never zooms back out. This is the only way to observe that rule without an iOS device, and it is the acceptance test both for the global rule in style.css and for the four utilities that live in a later cascade layer and beat it.
async function smallControls(page: Page) {
  return page.evaluate(() => {
    const report: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("input, select, textarea")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (parseFloat(style.fontSize) >= 16) continue;
      const name = el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.id ?? "";
      report.push(`${el.tagName.toLowerCase()}[${name}] ${style.fontSize}`);
    }
    return report;
  });
}

for (const route of ROUTES) {
  test(`nothing is clipped, undersized or zoom-triggering on ${route}`, async ({ page }, info) => {
    test.skip(!routesFor(info).includes(route), "this project only walks the routes that change band");
    await installFixtures(page);
    await open(page, route);

    // Soft throughout: with four sweeps over nine routes at twenty-four viewports, a run that stops at the first offender costs a full matrix to find the second one. Soft failures still fail the test.
    expect.soft(await clippedElements(page), "content clipped by an overflow:hidden ancestor").toEqual([]);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), "the document scrolls sideways").toBe(false);
    if (isCoarse(info)) {
      expect.soft(await smallTargets(page), "tap targets under 44px on a coarse pointer").toEqual([]);
      expect.soft(await smallControls(page), "controls under 16px zoom iOS Safari in on focus and never back out").toEqual([]);
    }
  });
}

// (d) Band identity. Structural facts of the model, not measurements of it: which side of <main> the shell sits on, and whether the table header is exposed or visually hidden. Both are derived from the numbers the page actually reports rather than predicted, so a scrollbar that eats fifteen pixels moves the assertion with the layout instead of against it.
test("the shell and the table header follow the band model", async ({ page }) => {
  await installFixtures(page);
  await open(page, "/#/pull-requests");
  const viewport = page.viewportSize()!.width;

  // The header is visually hidden on a phone but has to stay in the accessibility tree at every width, or the narrow layout is a table whose columns are unlabelled to a screen reader.
  await expect(page.getByRole("columnheader")).toHaveCount(5);

  const band = await page.evaluate(() => {
    const aside = document.querySelector("aside")!.getBoundingClientRect();
    const main = document.querySelector("main")!;
    const mainStyle = getComputedStyle(main);
    const head = document.querySelector('[role="table"] > [role="row"]')!;
    return {
      asidePosition: getComputedStyle(document.querySelector("aside")!).position,
      asideWidth: Math.round(aside.width),
      asideBottom: Math.round(aside.bottom),
      asideRight: Math.round(aside.right),
      mainTop: Math.round(main.getBoundingClientRect().top),
      mainLeft: Math.round(main.getBoundingClientRect().left),
      // The container query resolves against <main>'s content box, so that is what the `row` assertion below has to compare against — not the viewport, which is a different number by the width of the sidebar plus the padding.
      content: main.clientWidth - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
      headPosition: getComputedStyle(head).position,
    };
  });

  // Sticky in both bands: as a top bar because the list below runs to thousands of pixels with no second copy of the navigation, and as a column because it is taller than a short window.
  expect(band.asidePosition).toBe("sticky");
  if (viewport >= 900) {
    expect(band.asideWidth, "the sidebar is a 208px column from the shell token up").toBe(208);
    expect(band.asideRight, "the sidebar sits left of the content").toBeLessThanOrEqual(band.mainLeft + 1);
  } else {
    expect(band.asideBottom, "the top bar sits above the content").toBeLessThanOrEqual(band.mainTop + 1);
  }
  // `sr-only` is `position: absolute`, `not-sr-only` is `position: static`. Comparing against the measured content width rather than the viewport is what makes this test fail if the header is ever moved back onto a viewport query.
  expect(band.headPosition, `the header row is exposed from the container row token up (content box ${band.content}px)`).toBe(band.content >= 640 ? "static" : "absolute");
});

// (e) Monotonicity. The direct regression test for the claim the whole scale rests on: widening the window must never take columns away. Today's 900px shell switch drops <main> from 867px to 647px in one pixel, so any structural threshold between those two numbers downgrades the layout as the window grows — which is exactly what the old 760.02px repository threshold did for the 118 pixels above 900.
test("no layout loses grid columns as the viewport widens", async ({ page }) => {
  test.skip(test.info().project.name !== "laptop", "this test drives its own viewports, so one project is enough");
  test.setTimeout(180_000);
  await installFixtures(page);

  for (const [route, selector] of [
    ["/#/repositories", "ul li"],
    ["/#/pull-requests", '[role="table"] > [role="row"]:nth-child(2)'],
  ] as const) {
    await open(page, route);
    const tracks: { width: number; count: number }[] = [];
    for (let width = 320; width <= 1920; width += 8) {
      await page.setViewportSize({ width, height: 800 });
      const count = await page.evaluate(async (target) => {
        // Two frames: container queries are resolved during layout, and the first frame after a resize is the one that performs it.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
        const el = document.querySelector(target);
        if (!el) return -1;
        const columns = getComputedStyle(el).gridTemplateColumns;
        return columns === "none" ? 0 : columns.split(/\s+/).filter(Boolean).length;
      }, selector);
      tracks.push({ width, count });
    }

    expect(
      tracks.filter((step) => step.count < 1).map((step) => `${step.width}px`),
      `${route}: the measured row disappeared or stopped being a grid`,
    ).toEqual([]);
    const regressions: string[] = [];
    for (let index = 1; index < tracks.length; index += 1) {
      const previous = tracks[index - 1];
      const step = tracks[index];
      if (step.count < previous.count) regressions.push(`${previous.width}px had ${previous.count} tracks, ${step.width}px has ${step.count}`);
    }
    expect(regressions, `${route}: widening the window must not remove columns`).toEqual([]);
  }
});

// The width axis is only half of it. Spanish is the worst case for the shell's labels and Japanese for line breaking, and before this the suite rendered neither at any width. Kept to the three phone widths plus the `roomy` edge, which is where a label first gets enough room to be a label, so the matrix does not triple.
const LOCALE_PROJECTS = ["phone-320", "phone-360", "phone-390", "edge-480"];
for (const locale of ["es", "ja"]) {
  for (const route of STRUCTURAL_ROUTES.concat("/#/settings")) {
    test(`${locale} fits ${route}`, async ({ page }, info) => {
      test.skip(!LOCALE_PROJECTS.includes(info.project.name), "the locale axis runs at the narrow widths only");
      await installFixtures(page, { locale });
      await open(page, route);
      expect.soft(await clippedElements(page), `content clipped by an overflow:hidden ancestor in ${locale}`).toEqual([]);
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `the document scrolls sideways in ${locale}`).toBe(false);
      if (isCoarse(info)) expect.soft(await smallTargets(page), `tap targets under 44px in ${locale}`).toEqual([]);
    });
  }
}
