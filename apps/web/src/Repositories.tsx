import { AlertTriangle, ArrowUpRight, Check, FolderGit2, GitPullRequest, Inbox, Search, X } from "lucide-react";
import { emptyState, linkAction, secondaryAction } from "./action-styles";
import {
  repositoryAction,
  repositoryAttention,
  repositoryAvatar,
  repositoryColumns,
  repositoryConflicts,
  repositoryControlLabel,
  repositoryControls,
  repositoryIdentity,
  repositoryListCaption,
  repositoryListPanel,
  repositoryMobileLabel,
  repositoryNumber,
  repositoryNumberLink,
  repositoryRow,
  repositoryRows,
  repositoryScopeNote,
  repositorySearch,
  repositorySummary,
  repositorySummaryItem,
  repositoryZero,
} from "./repository-styles";
import { syncStatusError } from "./status-styles";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as Tabs from "@radix-ui/react-tabs";
import { RepositorySkeleton } from "./LoadingSkeleton";
import type { RepositorySummary } from "./pr-model";

export function Repositories({ repositories, loading, error, retry }: { repositories: RepositorySummary[] | undefined; loading: boolean; error: boolean; retry: () => void }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") || "";
  const owner = params.get("owner") || "";
  const scope = ["attention", "conflicts"].includes(params.get("scope") || "") ? params.get("scope")! : "all";
  const sort = ["name", "open"].includes(params.get("sort") || "") ? params.get("sort")! : "attention";
  const all = repositories || [];
  const owners = [...new Set(all.map((repo) => repo.repo.split("/")[0]))].sort((a, b) => a.localeCompare(b));
  const counts = { all: all.length, attention: all.filter((repo) => repo.needs_attention > 0).length, conflicts: all.filter((repo) => repo.conflicts > 0).length };
  const change = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  const shown = all
    .filter((repo) => (!owner || repo.repo.split("/")[0] === owner) && repo.repo.toLowerCase().includes(search.trim().toLowerCase()) && (scope === "attention" ? repo.needs_attention > 0 : scope === "conflicts" ? repo.conflicts > 0 : true))
    .sort((a, b) => (sort === "name" ? 0 : sort === "open" ? b.open - a.open : b.needs_attention - a.needs_attention || b.conflicts - a.conflicts) || a.repo.localeCompare(b.repo));
  const filtered = !!search || !!owner || scope !== "all";
  const clear = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["q", "owner", "scope", "page"]) next.delete(key);
      return next;
    });
  return (
    <section id="repositories" className="grid gap-[22px]">
      <Tabs.Root className="grid gap-5" value={scope} onValueChange={(value) => change("scope", value === "all" ? "" : value)}>
        <Tabs.List className={repositorySummary} aria-label={t("repositoryScope")}>
          {(
            [
              { value: "all", label: "activeRepositories", icon: FolderGit2 },
              { value: "attention", label: "attentionRepositories", icon: Inbox },
              { value: "conflicts", label: "conflictRepositories", icon: AlertTriangle },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <Tabs.Trigger key={value} value={value} className={repositorySummaryItem}>
              <span>
                <Icon size={17} aria-hidden="true" />
                {t(label)}
              </span>
              <strong>{loading || !repositories ? "—" : counts[value].toLocaleString()}</strong>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={scope} className={repositoryListPanel}>
          <div className={repositoryControls}>
            <label className={repositorySearch}>
              <Search size={17} aria-hidden="true" />
              <input id="pr-search" type="search" maxLength={120} aria-label={t("searchRepositories")} placeholder={t("repositorySearchPlaceholder")} value={search} onChange={(event) => change("q", event.target.value)} />
              {search && (
                <button aria-label={t("clear")} onClick={() => change("q", "")}>
                  <X size={15} />
                </button>
              )}
            </label>
            <label className={repositoryControlLabel}>
              <span>{t("repositoryOwner")}</span>
              <select aria-label={t("repositoryOwner")} value={owner} onChange={(event) => change("owner", event.target.value)}>
                <option value="">{t("allOwners")}</option>
                {owner && !owners.includes(owner) && <option value={owner}>{owner}</option>}
                {owners.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={repositoryControlLabel}>
              <span>{t("repositorySort")}</span>
              <select aria-label={t("repositorySort")} value={sort} onChange={(event) => change("sort", event.target.value)}>
                <option value="attention">{t("sortAttention")}</option>
                <option value="open">{t("sortOpen")}</option>
                <option value="name">{t("sortName")}</option>
              </select>
            </label>
          </div>
          <div className={repositoryListCaption}>
            <span>
              {repositories ? t("repositoryResults", { count: shown.length }) : "—"}
              <span className={repositoryScopeNote}> · {t("repositoryOpenScope")}</span>
            </span>
            {filtered && (
              <button onClick={clear}>
                {t("clearFilters")}
                <X size={13} />
              </button>
            )}
          </div>
          {error && repositories && (
            <div className={syncStatusError} role="status">
              <span>{t("refreshFailedKeepData")}</span>
              <button className={linkAction} onClick={retry}>
                {t("retry")}
              </button>
            </div>
          )}
          {loading ? (
            <RepositorySkeleton />
          ) : error && !repositories ? (
            <div className={emptyState} role="alert">
              <AlertTriangle size={28} />
              <h2>{t("unableRepositories")}</h2>
              <button className={secondaryAction} onClick={retry}>
                {t("retry")}
              </button>
            </div>
          ) : !shown.length ? (
            <div className={emptyState}>
              <FolderGit2 size={28} />
              <h2>{t("emptyResultsTitle")}</h2>
              <p>{t(filtered ? "emptyResultsDescription" : "noRepos")}</p>
              {filtered && (
                <button className={secondaryAction} onClick={clear}>
                  {t("clearFilters")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className={repositoryColumns} aria-hidden="true">
                <span>{t("repositories")}</span>
                <span>{t("open")}</span>
                <span>{t("navAttention")}</span>
                <span>{t("conflicts")}</span>
                <span />
              </div>
              <ul className={repositoryRows}>
                {shown.map((repo) => {
                  const [organization, ...name] = repo.repo.split("/");
                  const prURL = "/pull-requests?" + new URLSearchParams({ repo: repo.repo });
                  return (
                    <li className={repositoryRow} key={repo.repo}>
                      <div className={repositoryIdentity}>
                        <span className={repositoryAvatar} aria-hidden="true">
                          {organization.slice(0, 2).toUpperCase()}
                        </span>
                        <a href={`https://github.com/${repo.repo}`} target="_blank" rel="noopener noreferrer" title={repo.repo}>
                          <span>{organization}</span>
                          <strong>
                            {name.join("/")}
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </strong>
                        </a>
                      </div>
                      <Link className={repositoryNumberLink} to={prURL} aria-label={t("repositoryOpenLink", { repo: repo.repo, count: repo.open })}>
                        <span className={repositoryMobileLabel}>
                          <GitPullRequest size={13} />
                          {t("open")}
                        </span>
                        {repo.open.toLocaleString()}
                      </Link>
                      <div className={repositoryNumber}>
                        <span className={repositoryMobileLabel}>{t("navAttention")}</span>
                        {repo.needs_attention > 0 ? (
                          <Link className={repositoryAttention} to={"/attention?" + new URLSearchParams({ repo: repo.repo })} aria-label={t("repositoryAttentionLink", { repo: repo.repo, count: repo.needs_attention })}>
                            {repo.needs_attention.toLocaleString()}
                          </Link>
                        ) : (
                          <span className={repositoryZero}>0</span>
                        )}
                      </div>
                      <div className={repositoryNumber}>
                        <span className={repositoryMobileLabel}>{t("conflicts")}</span>
                        <span className={repo.conflicts ? repositoryConflicts : repositoryZero}>{repo.conflicts.toLocaleString()}</span>
                      </div>
                      <Link className={repositoryAction} to={prURL}>
                        {repo.needs_attention === 0 && <Check size={14} className="opacity-60" aria-hidden="true" />}
                        <span>{t("viewRepositoryPRs")}</span>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
