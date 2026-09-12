// The comparison harness in tests/tools is not part of the suite and must not
// run in CI, so it gets its own config rather than widening the testDir of the
// one that does.
import { defineConfig, devices } from "@playwright/test";

// Port 5190, not the suite's 5189: both configs set `reuseExistingServer: false`, so sharing a port meant a harness capture and a matrix run could not overlap and one of them died on a bound port.
export default defineConfig({ testDir: "./tests/tools", reporter: "line", use: { baseURL: "http://127.0.0.1:5190", ...devices["Desktop Chrome"] }, webServer: { command: "bun run --cwd apps/web dev --host 127.0.0.1 --port 5190 --strictPort", url: "http://127.0.0.1:5190", reuseExistingServer: false } });
