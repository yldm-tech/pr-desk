// The comparison harness in tests/tools is not part of the suite and must not
// run in CI, so it gets its own config rather than widening the testDir of the
// one that does.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({ testDir: "./tests/tools", reporter: "line", use: { baseURL: "http://127.0.0.1:5189", ...devices["Desktop Chrome"] }, webServer: { command: "bun run --cwd apps/web dev --host 127.0.0.1 --port 5189 --strictPort", url: "http://127.0.0.1:5189", reuseExistingServer: false } });
