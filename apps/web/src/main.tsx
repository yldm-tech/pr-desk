import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { SkeletonTheme } from "react-loading-skeleton";
import { registerServiceWorker } from "./service-worker";
import "./style.css";

const client = new QueryClient();
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
