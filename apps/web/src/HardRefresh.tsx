import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { headerRefresh, spinning } from "./app-styles";
import { hardReload } from "./service-worker";

// Every display mode an installed PR Desk can be opened in, which is the whole question this control asks: a tab has the browser's own reload and does not need a second one taking space in the header, an installed window has no chrome at all. `window-controls-overlay` and `minimal-ui` are in the list because both are installed modes that hide the reload — minimal-ui keeps a back button on some platforms and nothing else.
const INSTALLED = "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen), (display-mode: window-controls-overlay)";

// iOS added the display-mode query in 13; older home-screen installs report themselves only through this non-standard flag, and a reader on one of them is exactly the reader with no reload.
const iosStandalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true;

const installed = () => (typeof matchMedia === "function" && matchMedia(INSTALLED).matches) || iosStandalone();

export function HardRefresh() {
  const { t } = useTranslation();
  // Read once for the first paint and then kept current: a window can be installed, or leave standalone for a tab, without the document being reloaded.
  const [standalone, setStandalone] = useState(installed);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(INSTALLED);
    const update = () => setStandalone(query.matches || iosStandalone());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (!standalone) return null;
  return (
    <button
      className={headerRefresh}
      type="button"
      // The label is the accessible name and the tooltip both: the cluster beside it already carries a language name and an account, and a third word is what stops the header fitting on a phone-width install.
      aria-label={t("hardRefresh")}
      title={t("hardRefresh")}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => {
        setBusy(true);
        // The page is on its way out either way: the promise only resolves if something upstream refuses to reload, and a spinner that never stops is the honest picture of that.
        void hardReload();
      }}
    >
      <RotateCw size={16} className={busy ? spinning : ""} aria-hidden="true" />
    </button>
  );
}
