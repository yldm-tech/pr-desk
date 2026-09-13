import { defineConfig, devices } from "@playwright/test";

// `devices["Desktop Chrome"]` is 1280x720 with `hasTouch: false`, so Chromium reports `pointer: fine` and every `pointer-coarse:` rule in the stylesheet is inert. That is why the behavioural suite could never observe a tap-target or control-font regression, and it is why the layout projects below set `hasTouch`/`isMobile` explicitly rather than relying on the viewport alone.
// `metadata.routes` picks how much of the application each project walks: the device projects sweep every route, while the one-pixel-either-side edge projects only walk the three routes that carry a structural band flip. Sweeping all nine routes at all fourteen edges would triple the job for widths where only the shell and the two list layouts can change.
const layout = (name: string, width: number, height: number, touch: boolean, routes: "all" | "structural" = "all") => ({ name, testMatch: /layout\.spec\.ts/, metadata: { routes }, use: { ...devices["Desktop Chrome"], viewport: { width, height }, hasTouch: touch, isMobile: touch } });

export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: "http://127.0.0.1:5189", ...devices["Desktop Chrome"] },
  webServer: { command: "bun run --cwd apps/web dev --host 127.0.0.1 --port 5189 --strictPort", url: "http://127.0.0.1:5189", reuseExistingServer: false },
  projects: [
    // Unchanged: the behavioural tests keep running exactly once, at the configuration they have always run at. `testIgnore` rather than a grep tag so the split is structural and a new behavioural test cannot accidentally opt into twenty-five runs.
    { name: "desktop", testIgnore: /layout\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    layout("phone-320", 320, 568, true),
    layout("phone-360", 360, 640, true),
    layout("phone-390", 390, 844, true),
    layout("phone-412", 412, 915, true),
    layout("phone-landscape", 844, 390, true),
    layout("tablet-portrait", 768, 1024, true),
    layout("tablet-landscape", 1024, 768, true),
    // 1280x800 at 200% browser zoom reports a 640px layout viewport with a fine pointer.
    layout("zoom-200", 640, 400, false),
    layout("laptop", 1280, 800, false),
    layout("wide", 1920, 1080, false),
    // One pixel either side of every token in the scale, plus the viewports that straddle the container tokens through the shell. These are the widths the design is most fragile at and the only ones a dead zone or a non-monotonic band shows up in.
    layout("edge-479", 479, 800, false, "structural"),
    layout("edge-480", 480, 800, false, "structural"),
    layout("edge-639", 639, 800, false, "structural"),
    layout("edge-640", 640, 800, false, "structural"),
    // Container `row`: <main>'s content box is 640px at a 672px viewport while the top bar is in use.
    layout("edge-671", 671, 800, false, "structural"),
    layout("edge-672", 672, 800, false, "structural"),
    layout("edge-879", 879, 800, false, "structural"),
    layout("edge-880", 880, 800, false, "structural"),
    // The shell switch, and the old 900/901 hole where neither `max-[900px]:` nor `min-[901px]:` matched.
    layout("edge-899", 899, 800, false, "structural"),
    layout("edge-900", 900, 800, false, "structural"),
    // Container `table`: 0.95V - 208 crosses 880px between these two viewports.
    layout("edge-1145", 1145, 800, false, "structural"),
    layout("edge-1146", 1146, 800, false, "structural"),
    layout("edge-1199", 1199, 800, false, "structural"),
    layout("edge-1200", 1200, 800, false, "structural"),
  ],
});
