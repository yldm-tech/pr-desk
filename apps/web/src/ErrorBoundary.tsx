import React from "react";
import { useTranslation } from "react-i18next";
import { RotateCw, TriangleAlert } from "lucide-react";
import { isChunkLoadError } from "./chunk-error";
import { Button } from "./ui-controls";

// Rendered in place of whatever failed, which is either the whole app (nothing else is left on screen, so it is centred in the window) or one lazy page inside the shell. It names the failure as the page heading because there is no other heading left to name it, and offers the one action that can recover: a reload.
function CrashFallback() {
  const { t } = useTranslation();
  return (
    <section role="alert" className="grid min-h-[60dvh] place-items-center px-4 py-12 text-center">
      <div className="grid max-w-[36rem] justify-items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-tone-blocked-soft text-tone-blocked">
          <TriangleAlert size={20} aria-hidden="true" />
        </span>
        <h1 className="text-title font-semibold text-fg">{t("appCrashed")}</h1>
        <Button variant="primary" icon={RotateCw} onClick={() => location.reload()}>
          {t("reloadApp")}
        </Button>
      </div>
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
