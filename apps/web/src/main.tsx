import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { SkeletonTheme } from "react-loading-skeleton";
import "./style.css";
import "./workspace.css";
import "./followup.css";

const client = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <SkeletonTheme baseColor="var(--skeleton-base)" highlightColor="var(--skeleton-highlight)">
      <HashRouter>
        <App />
      </HashRouter>
    </SkeletonTheme>
  </QueryClientProvider>,
);
