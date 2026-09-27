import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HTTPError } from "ky";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { SkeletonTheme } from "react-loading-skeleton";
import { registerServiceWorker } from "./service-worker";
import "./style.css";

// One retry, soon, for every query that does not set its own: a failed load is on screen within about a second instead of behind TanStack's default three retries with backoff (about seven seconds of skeleton), and a 4xx other than a timeout is an answer rather than a blip, so it is not asked twice. Offline is not a retry case at all: queries pause until the network is back.
const client = new QueryClient({ defaultOptions: { queries: { retry: (failures, error) => failures < 1 && !(error instanceof HTTPError && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 408), retryDelay: 600 } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <SkeletonTheme baseColor="var(--skeleton-base)" highlightColor="var(--skeleton-highlight)">
      <HashRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </HashRouter>
    </SkeletonTheme>
  </QueryClientProvider>,
);

registerServiceWorker();
