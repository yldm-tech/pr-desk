import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { paths } from "./routes";
import { BarList } from "./ui-display";

// Each repository's share of the period, ranked, as a table a screen reader walks cell by cell. The name opens that repository's pull requests here; the arrow beside it is the way out to GitHub, a separate target so a tap on the name never leaves the app. The table keeps the `repository-breakdown` id the old donut pointed touch readers at.
export function RepoBreakdown({ repositories, total }: { repositories: { repo: string; total: number }[]; total: number }) {
  const { t } = useTranslation();
  const rows = [...repositories]
    .sort((a, b) => b.total - a.total || a.repo.localeCompare(b.repo))
    .map((item) => ({
      key: item.repo,
      value: item.total,
      share: total ? item.total / total : 0,
      label: (
        <span className="inline-flex max-w-full min-w-0 items-center gap-1 align-middle">
          <Link to={`${paths.prs}?${new URLSearchParams({ repo: item.repo })}`} title={item.repo} className="min-w-0 truncate rounded-sm text-fg no-underline hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
            {item.repo}
          </Link>
          <a
            href={`https://github.com/${item.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t("insights.openRepository", { repo: item.repo })} (${t("insights.newTab")})`}
            title={t("insights.openRepository", { repo: item.repo })}
            className="inline-grid size-6 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-bg-muted hover:text-fg pointer-coarse:size-11"
          >
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </span>
      ),
    }));
  return <BarList id="repository-breakdown" caption={t("insights.byRepository")} columns={[t("repository"), t("insights.prsColumn"), t("contributionShare")]} rows={rows} />;
}
