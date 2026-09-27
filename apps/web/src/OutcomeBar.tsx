import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { prViewPath } from "./routes";
import { cx } from "./ui-controls";

type Outcome = { key: "merged" | "open" | "closed"; label: string; value: number; fill: string; to?: string };

// How the period's contributions ended, as one stacked bar. The bar is a picture of the legend and is hidden from assistive technology; the legend under it prints every value and share, so nothing depends on telling the colours apart. Merged and Open name lists the reader can open, the merged view and the open-and-unmerged default, so their labels are links; Closed has no list of its own and stays text rather than pointing at a list that would answer with a different set.
export function OutcomeBar({ merged, open, closed }: { merged: number; open: number; closed: number }) {
  const { t, i18n } = useTranslation();
  const total = merged + open + closed;
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 1 });
  const outcomes: Outcome[] = [
    { key: "merged", label: t("merged"), value: merged, fill: "bg-tone-ready", to: prViewPath("merged") },
    { key: "open", label: t("openStatus"), value: open, fill: "bg-tone-waiting", to: prViewPath("open") },
    { key: "closed", label: t("closed"), value: closed, fill: "bg-fg-subtle" },
  ];
  return (
    <div className="grid min-w-0 gap-3">
      <div aria-hidden="true" data-segments="" className="flex h-2 min-w-0 gap-0.5 overflow-hidden rounded-full bg-bg-muted">
        {outcomes
          .filter((outcome) => outcome.value > 0)
          .map((outcome) => (
            <span key={outcome.key} data-segment={outcome.key} className={cx("h-full min-w-1 first:rounded-l-full last:rounded-r-full", outcome.fill)} style={{ flexGrow: outcome.value, flexBasis: 0 }} />
          ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-body">
        {outcomes.map((outcome) => (
          <li key={outcome.key} className="inline-flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-sm", outcome.fill)} />
            {outcome.to ? (
              <Link to={outcome.to} className="rounded-sm text-fg-muted underline decoration-current/40 underline-offset-2 hover:text-fg pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center">
                {outcome.label}
              </Link>
            ) : (
              <span className="text-fg-muted">{outcome.label}</span>
            )}
            <span className="font-semibold text-fg tabular-nums">{number.format(outcome.value)}</span>
            <span className="text-caption text-fg-subtle tabular-nums">{percent.format(total ? outcome.value / total : 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
