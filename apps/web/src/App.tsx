import { DetailProvider } from "./detail-context";
import { AppRoutes, LegacyRedirect } from "./AppRoutes";
import { Shell } from "./Shell";

// Providers, the shell and the route table, and nothing else: the queries live in queries.ts, the chrome in Shell.tsx and each page in its own file.
export default function App() {
  return (
    <DetailProvider>
      <LegacyRedirect>
        <Shell>
          <AppRoutes />
        </Shell>
      </LegacyRedirect>
    </DetailProvider>
  );
}
