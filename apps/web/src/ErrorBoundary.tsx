import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { isChunkLoadError } from "./chunk-error";
import { emptyState, secondaryAction } from "./action-styles";

function CrashFallback() {
  const { t } = useTranslation();
  return (
    <section className={emptyState} role="alert">
      <AlertTriangle size={28} />
      <h2>{t("appCrashed")}</h2>
      <button className={secondaryAction} onClick={() => location.reload()}>
        {t("reloadApp")}
      </button>
    </section>
  );
}

// React 19 unmounts the whole root on an uncaught render error, which leaves a blank page with no way back.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    // React does not log an error a boundary handled, and the stack is what makes a report actionable.
    console.error(error);
    // An upgraded server serves new chunk hashes, so an open tab asks for a file that is gone; one reload adopts the new build, and the flag keeps a permanently broken deploy from looping.
    if (isChunkLoadError(error) && !sessionStorage.getItem("prdesk-chunk-reload")) {
      sessionStorage.setItem("prdesk-chunk-reload", "1");
      location.reload();
    }
  }
  render() {
    return this.state.failed ? <CrashFallback /> : this.props.children;
  }
}
