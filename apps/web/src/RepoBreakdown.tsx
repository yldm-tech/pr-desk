import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useThemeColors } from "./chart-colors";
import { Donut } from "./Donut";
import { paths } from "./routes";
import { BarList } from "./ui-display";

// The ring's categorical slots, in the order the palette was validated in. A sixth repository and beyond share the "other" slot and one slice, rather than a generated hue that no one checked against the rest.
const seriesTokens = ["--chart-series-1", "--chart-series-2", "--chart-series-3", "--chart-series-4", "--chart-series-5"] as const;
const otherToken = "--chart-series-other";

// Each repository's share of the period, ranked, as a ring and as a table a screen reader walks cell by cell. The swatch on each row is the ring's legend, so a slice is never told apart by colour alone. The name opens that repository's pull requests here; the arrow beside it is the way out to GitHub, a separate target so a tap on the name never leaves the app. The table keeps the `repository-breakdown` id the old donut pointed touch readers at.
export function RepoBreakdown({ repositories, total }: { repositories: { repo: string; total: number }[]; total: number }) {
  const { t, i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 1 });
  const colors = useThemeColors([...seriesTokens, otherToken]);
  const ranked = [...repositories].sort((a, b) => b.total - a.total || a.repo.localeCompare(b.repo));
  const rest = ranked.slice(seriesTokens.length).reduce((sum, item) => sum + item.total, 0);
  const share = (value: number) => percent.format(total ? value / total : 0);
  const slices = [
    ...ranked.slice(0, seriesTokens.length).map((item, index) => ({ key: item.repo, label: item.repo, value: item.total, color: colors[index], share: share(item.total) })),
    ...(rest > 0 ? [{ key: "other", label: t("insights.otherRepositories"), value: rest, color: colors[seriesTokens.length], share: share(rest) }] : []),
  ];
  const rows = ranked.map((item, index) => ({
    key: item.repo,
    value: item.total,
    share: total ? item.total / total : 0,
    label: (
      <span className="inline-flex max-w-full min-w-0 items-center gap-1 align-middle">
        <span aria-hidden="true" className="mr-1 size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: `var(${seriesTokens[index] ?? otherToken})` }} />
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
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-4">
      <BarList id="repository-breakdown" caption={t("insights.byRepository")} columns={[t("repository"), t("insights.prsColumn"), t("contributionShare")]} rows={rows} className="min-w-0 flex-1 basis-64" />
      <div className="flex flex-1 basis-36 justify-center">
        <Donut slices={slices} ariaLabel={t("insights.byRepository")} nameLabel={t("repository")} />
      </div>
    </div>
  );
}
