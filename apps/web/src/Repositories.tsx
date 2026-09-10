import { AlertTriangle, ArrowUpRight, Check, FolderGit2, GitPullRequest, Inbox, Search, X } from "lucide-react";
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
    <section id="repositories" className="repository-workspace">
      <Tabs.Root className="grid gap-5" value={scope} onValueChange={(value) => change("scope", value === "all" ? "" : value)}>
        <Tabs.List className="repository-summary" aria-label={t("repositoryScope")}>
          {(
            [
              { value: "all", label: "activeRepositories", icon: FolderGit2 },
              { value: "attention", label: "attentionRepositories", icon: Inbox },
              { value: "conflicts", label: "conflictRepositories", icon: AlertTriangle },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <Tabs.Trigger key={value} value={value} className="repository-summary-item">
              <span>
                <Icon size={17} aria-hidden="true" />
                {t(label)}
              </span>
              <strong>{loading || !repositories ? "—" : counts[value].toLocaleString()}</strong>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={scope} className="repository-list-panel">
          <div className="repository-controls">
            <label className="repository-search">
              <Search size={17} aria-hidden="true" />
              <input id="pr-search" type="search" maxLength={120} aria-label={t("searchRepositories")} placeholder={t("repositorySearchPlaceholder")} value={search} onChange={(event) => change("q", event.target.value)} />
              {search && (
                <button aria-label={t("clear")} onClick={() => change("q", "")}>
                  <X size={15} />
                </button>
              )}
            </label>
            <label className="repository-control-label">
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
            <label className="repository-control-label">
              <span>{t("repositorySort")}</span>
              <select aria-label={t("repositorySort")} value={sort} onChange={(event) => change("sort", event.target.value)}>
                <option value="attention">{t("sortAttention")}</option>
                <option value="open">{t("sortOpen")}</option>
                <option value="name">{t("sortName")}</option>
              </select>
            </label>
          </div>
          <div className="repository-list-caption">
            <span>
              {repositories ? t("repositoryResults", { count: shown.length }) : "—"}
              <span className="repository-scope-note"> · {t("repositoryOpenScope")}</span>
            </span>
            {filtered && (
              <button onClick={clear}>
                {t("clearFilters")}
                <X size={13} />
              </button>
            )}
          </div>
          {error && repositories && (
            <div className="sync-status-error" role="status">
              <span>{t("refreshFailedKeepData")}</span>
              <button className="access-recheck" onClick={retry}>
                {t("retry")}
              </button>
            </div>
          )}
          {loading ? (
            <RepositorySkeleton />
          ) : error && !repositories ? (
            <div className="empty-state" role="alert">
              <AlertTriangle size={28} />
              <h2>{t("unableRepositories")}</h2>
              <button className="secondary-action" onClick={retry}>
                {t("retry")}
              </button>
            </div>
          ) : !shown.length ? (
            <div className="empty-state">
              <FolderGit2 size={28} />
              <h2>{t("emptyResultsTitle")}</h2>
              <p>{t(filtered ? "emptyResultsDescription" : "noRepos")}</p>
              {filtered && (
                <button className="secondary-action" onClick={clear}>
                  {t("clearFilters")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="repository-columns" aria-hidden="true">
                <span>{t("repositories")}</span>
                <span>{t("open")}</span>
                <span>{t("navAttention")}</span>
                <span>{t("conflicts")}</span>
                <span />
              </div>
              <ul className="repository-rows">
                {shown.map((repo) => {
                  const [organization, ...name] = repo.repo.split("/");
                  const prURL = "/pull-requests?" + new URLSearchParams({ repo: repo.repo });
                  return (
                    <li className="repository-row" key={repo.repo}>
                      <div className="repository-identity">
                        <span className="repository-avatar" aria-hidden="true">
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
                      <Link className="repository-number" to={prURL} aria-label={t("repositoryOpenLink", { repo: repo.repo, count: repo.open })}>
                        <span className="repository-mobile-label">
                          <GitPullRequest size={13} />
                          {t("open")}
                        </span>
                        {repo.open.toLocaleString()}
                      </Link>
                      <div className="repository-number">
                        <span className="repository-mobile-label">{t("navAttention")}</span>
                        {repo.needs_attention > 0 ? (
                          <Link className="repository-attention" to={"/attention?" + new URLSearchParams({ repo: repo.repo })} aria-label={t("repositoryAttentionLink", { repo: repo.repo, count: repo.needs_attention })}>
                            {repo.needs_attention.toLocaleString()}
                          </Link>
                        ) : (
                          <span className="repository-zero">0</span>
                        )}
                      </div>
                      <div className="repository-number">
                        <span className="repository-mobile-label">{t("conflicts")}</span>
                        <span className={repo.conflicts ? "repository-conflicts" : "repository-zero"}>{repo.conflicts.toLocaleString()}</span>
                      </div>
                      <Link className="repository-action" to={prURL}>
                        {repo.needs_attention === 0 && <Check size={14} className="repository-clear" aria-hidden="true" />}
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
