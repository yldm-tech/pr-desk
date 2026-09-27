import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { apiURL } from "./api-url";
import { LinkButton } from "./ui-controls";
import { Notice } from "./ui-display";
import { isFirstSyncRunning, SyncDetail, syncFailureKey, type SyncProgressData } from "./SyncProgress";
import type { Auth } from "./queries";

// The failures only a new GitHub authorization can clear. Every other failed run retries by itself, so it is reported in the sync pill rather than across the top of every page.
const reconnectCodes = new Set(["reconnect", "forbidden"]);

// What has to be said above every page, in priority order, and never more than two of them: a column of notices would push the page itself below the fold on a phone. None of them is shown on About, which is readable signed out and is not about the reader's data.
export function Banners({ auth, progress, oauthError, onDismissOAuth }: { auth: Auth | undefined; progress: SyncProgressData | undefined; oauthError: boolean; onDismissOAuth: () => void }) {
  const { t } = useTranslation();
  const reconnect = (
    <LinkButton size="sm" variant="secondary" href={apiURL + "/api/v1/auth/github"}>
      {t("followup.reconnect")}
    </LinkButton>
  );
  const banners: { key: string; node: ReactNode }[] = [];
  if (auth?.sync_paused)
    banners.push({
      key: "paused",
      node: (
        <Notice tone="danger" role="status" actions={reconnect}>
          {t("followup.paused")}
        </Notice>
      ),
    });
  // A paused session already says "reconnect"; the failed run that caused the pause would only say it again.
  if (!auth?.sync_paused && (progress?.status === "failed" || progress?.status === "interrupted") && reconnectCodes.has(progress.error_code ?? ""))
    banners.push({
      key: "reconnect",
      node: (
        <Notice tone="danger" role="status" actions={reconnect}>
          {t(syncFailureKey(progress))}
        </Notice>
      ),
    });
  if (oauthError)
    banners.push({
      key: "oauth",
      node: (
        <Notice tone="warning" role="alert" onDismiss={onDismissOAuth} dismissLabel={t("dismissMessage")}>
          {t("oauthCancelled")}
        </Notice>
      ),
    });
  // The first import is the one wait a new reader sits through, so its progress stays in view on every page until it finishes; it cannot be dismissed because there is nothing to dismiss it to.
  if (progress && isFirstSyncRunning(progress))
    banners.push({
      key: "first-sync",
      node: (
        <Notice tone="info">
          <div className="grid gap-2.5">
            <p className="text-fg-muted">{t("firstSyncHelp")}</p>
            <SyncDetail data={progress} compact />
          </div>
        </Notice>
      ),
    });
  if (!banners.length) return null;
  return (
    <div className="mb-4 grid gap-2" data-testid="banners">
      {banners.slice(0, 2).map((banner) => (
        <div key={banner.key}>{banner.node}</div>
      ))}
    </div>
  );
}
