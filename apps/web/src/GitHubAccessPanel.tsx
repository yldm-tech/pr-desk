import { useId } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { Building2, CircleCheck, OctagonAlert, RefreshCw } from "lucide-react";
import { installHref, openInstallPopup, privateAccessMissing, useRepositoryAccess, type Installation } from "./github-access";
import { Button, cx, LinkButton, TextLink } from "./ui-controls";
import { Avatar, FactChip, Notice } from "./ui-display";

// One installation: the account it is on, what it may read, and the way to its settings on GitHub. An installation without pull request permission is the blocked case, because only a change on GitHub can clear it.
function InstallationRow({ installation }: { installation: Installation }) {
  const { t } = useTranslation();
  const readable = installation.can_read_prs;
  const scope = readable ? t(installation.repository_selection === "all" ? "allRepositoriesAuthorized" : "selectedRepositoriesAuthorized") : t("insights.permissionMissingShort");
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line py-2.5 first:border-t-0">
      <span className="inline-flex min-w-0 items-center gap-2">
        <Avatar login={installation.account} size={24} />
        <span className="min-w-0 truncate text-body font-medium text-fg" title={installation.account}>
          {installation.account}
        </span>
      </span>
      <FactChip tone={readable ? "ready" : "blocked"} icon={readable ? CircleCheck : OctagonAlert} title={readable ? undefined : t("privatePermissionMissing")}>
        {scope}
      </FactChip>
      <TextLink href={installation.settings_url} external newTabLabel={t("insights.newTab")} className="ml-auto text-small pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center">
        {t("insights.configure")}
      </TextLink>
    </li>
  );
}

function InstallationList({ installations, labelledBy, label, className }: { installations: Installation[]; labelledBy?: string; label?: string; className?: string }) {
  return (
    <ul aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className={cx("m-0 grid min-w-0 list-none p-0", className)}>
      {installations.map((installation) => (
        <InstallationRow key={installation.account} installation={installation} />
      ))}
    </ul>
  );
}

function AccessLoading({ rows }: { rows: number }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("checkingAccess")}>
      <div aria-hidden="true" className="grid">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <Skeleton circle width={24} height={24} />
            <Skeleton width={index % 2 ? 96 : 128} height={14} />
            <Skeleton width={150} height={20} />
          </div>
        ))}
      </div>
    </div>
  );
}

// The installations of PR Desk's GitHub App, which decide whether private repositories can be read. `full` is Settings › GitHub access: the whole card, with the state in words, every installation, and the install and recheck actions. `compact` is the list alone, for Insights' private scope, whose feedback line already carries the state and the actions. The check itself lives in useRepositoryAccess, which also starts the full sync when access is granted, so mounting this panel on two pages at once still syncs once.
export function GitHubAccessPanel({ variant }: { variant: "full" | "compact" }) {
  const { t } = useTranslation();
  const headingId = useId();
  const listId = useId();
  const access = useRepositoryAccess();
  const installations = access.data?.installations ?? [];
  if (variant === "compact") {
    if (access.isPending) return <AccessLoading rows={2} />;
    if (!installations.length) return null;
    return <InstallationList installations={installations} label={t("insights.installations")} className="rounded-lg border border-line px-3" />;
  }
  const href = installHref(access.data);
  const missing = privateAccessMissing(access.data);
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 overflow-hidden rounded-lg border border-line bg-bg-subtle">
      <div className="grid min-w-0 gap-4 p-4">
        <div className="grid gap-1">
          <h2 id={headingId} className="flex items-center gap-2 text-title font-semibold text-fg">
            <Building2 size={18} aria-hidden="true" className="shrink-0 text-fg-muted" />
            {t("insights.accessTitle")}
          </h2>
          <p className="text-body text-fg-muted">{t("insights.accessDescription")}</p>
        </div>
        {access.isError && !access.data ? (
          <Notice
            tone="danger"
            role="alert"
            actions={
              <Button size="sm" onClick={() => access.refetch()}>
                {t("retry")}
              </Button>
            }
          >
            {t("accessCheckFailed")}
          </Notice>
        ) : access.data ? (
          <Notice tone={missing ? (access.data.has_installations ? "warning" : "info") : "success"} role="status">
            {missing ? t(access.data.has_installations ? "privatePermissionMissing" : "privateAccessMissing") : t("insights.accessReady")}
          </Notice>
        ) : null}
        <div className="grid min-w-0 gap-1">
          <h3 id={listId} className="text-small font-semibold text-fg">
            {t("insights.installations")}
          </h3>
          {access.isPending ? <AccessLoading rows={2} /> : installations.length ? <InstallationList installations={installations} labelledBy={listId} /> : access.data ? <p className="py-2 text-body text-fg-muted">{t("insights.noInstallations")}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-bg px-4 py-3">
        <LinkButton href={href} external newTabLabel={t("insights.newTab")} variant={missing ? "primary" : "secondary"} onClick={(event) => openInstallPopup(event, href)}>
          {t("insights.installApp")}
        </LinkButton>
        <Button variant="ghost" icon={RefreshCw} busy={access.isFetching} onClick={() => access.refetch()}>
          {t("recheckAccess")}
        </Button>
      </div>
    </section>
  );
}
