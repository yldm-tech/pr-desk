import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { Chart } from "@tanstack/charts/react";
import { barY, defineChart, tickY } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useTheme } from "./theme";
import { Button } from "./ui-controls";

export type TrendMonth = { month: string; merged: number };

// The months the chart draws: every month of the period, with a zero where nothing merged, so a quiet month reads as a quiet month rather than a gap the axis closes over. The server's period is the rule: the current year is the thirteen months ending with this one (the same month last year through now), a past year is January to December. Months the server sent are kept whatever their range, so a server that widens the period is drawn as it answered.
export function fillMonths(months: TrendMonth[], year: number, now = new Date()): TrendMonth[] {
  const counts = new Map(months.map((item) => [item.month, item.merged]));
  const current = year === now.getUTCFullYear();
  const start = current ? Date.UTC(year - 1, now.getUTCMonth(), 1) : Date.UTC(year, 0, 1);
  const end = current ? Date.UTC(year, now.getUTCMonth(), 1) : Date.UTC(year, 11, 1);
  const keys = new Set(counts.keys());
  for (let cursor = new Date(start); cursor.getTime() <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) keys.add(cursor.toISOString().slice(0, 7));
  return [...keys].sort().map((month) => ({ month, merged: counts.get(month) ?? 0 }));
}

// The narrowest panel that still carries a label for every month; below it the axis is thinned. Thirteen months with a two-digit year at -35deg need about 35px of axis each, which a laptop panel has and a phone's 250-350px does not, and there the library drops the labels that collide. The number cannot be a container query: nothing in CSS can reach a chart option, so the panel has to be measured.
const allMonthsWidth = 420;

// The chart library paints SVG attributes, which cannot follow a custom property, so the colours are read from the theme once per theme change and handed over as values.
function useChartColors() {
  const { resolved } = useTheme();
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim() || "currentColor";
    return { bar: read("--chart-bar"), baseline: read("--fg-subtle") };
  }, [resolved]);
}

// Merges per month for the period, one series in the chart colour. The heading carries the period in the reader's language and says the months are UTC, which is how the server buckets them; `controls` is the repository picker, which sits in the header so changing it never moves the chart.
export function TrendChart({ months, loading, error, onRetry, controls }: { months: TrendMonth[]; loading: boolean; error: boolean; onRetry: () => void; controls?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const colors = useChartColors();
  const panel = useRef<HTMLElement>(null);
  // Starts optimistic so a browser without ResizeObserver, or the frame before the first observation, renders the full axis rather than a thinned one.
  const [fitsEveryMonth, setFitsEveryMonth] = useState(true);
  useEffect(() => {
    const element = panel.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setFitsEveryMonth((entries[0]?.contentRect.width ?? 0) >= allMonthsWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const spansYears = months[0]?.month.slice(0, 4) !== months[months.length - 1]?.month.slice(0, 4);
  const monthLabel = useMemo(() => new Intl.DateTimeFormat(language, { month: "short", year: spansYears ? "2-digit" : undefined, timeZone: "UTC" }), [language, spansYears]);
  const rangeLabel = useMemo(() => new Intl.DateTimeFormat(language, { month: "short", year: "numeric", timeZone: "UTC" }), [language]);
  const toDate = (month: string) => new Date(month + "-01T00:00:00Z");
  const total = months.reduce((sum, item) => sum + item.merged, 0);
  const first = months[0];
  const last = months[months.length - 1];
  const range = first && last ? t("insights.monthRange", { from: rangeLabel.format(toDate(first.month)), to: rangeLabel.format(toDate(last.month)) }) : "";
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(months, { x: "month", y: "merged", fill: colors.bar, radius: { end: 3 }, maxThickness: 28 }),
          // A month with nothing merged still gets a mark on the baseline, so zero is visibly a value rather than a missing bar.
          tickY(
            months.filter((item) => item.merged === 0),
            { x: "month", y: "merged", stroke: colors.baseline, strokeWidth: 2, span: 0.4 },
          ),
        ],
        scales: {
          x: {
            scale: () => scaleBand().padding(0.36),
            axis: {
              // `thin: false` pins every month; without it the library drops the labels whose boxes collide.
              tickLabels: fitsEveryMonth ? { rotate: -35, thin: false } : { rotate: -35 },
              line: false,
              ticks: { size: 0, padding: 10, format: (value) => monthLabel.format(toDate(String(value))) },
            },
          },
          y: { scale: scaleLinear, nice: true, grid: true, axis: { line: false, ticks: { size: 0, count: 3, padding: 8 } } },
        },
        tooltip: {
          use: tooltip,
          items: [
            { field: "month", label: t("month") },
            { field: "merged", label: t("mergedTotal") },
          ],
        },
      }),
    [months, colors, fitsEveryMonth, monthLabel, t],
  );
  return (
    <section ref={panel} aria-labelledby="merge-activity-heading" aria-busy={loading} className="@container/chart grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-col gap-2 @pair/chart:flex-row @pair/chart:items-start @pair/chart:justify-between">
        <div className="grid min-w-0 gap-0.5">
          <h3 id="merge-activity-heading" className="text-body font-semibold text-fg">
            {t("mergeActivity")}
          </h3>
          <p className="text-caption text-fg-subtle">
            {range}
            {range && " · "}
            {loading ? <Skeleton width={80} inline /> : <span className="tabular-nums">{t("insights.periodMerged", { count: total })}</span>}
          </p>
        </div>
        {controls}
      </div>
      {loading ? (
        <div role="status" aria-label={t("loading")}>
          <div aria-hidden="true">
            <Skeleton height={240} />
          </div>
        </div>
      ) : error ? (
        <div role="alert" className="grid min-h-60 place-content-center justify-items-center gap-2 rounded-lg border border-dashed border-line p-4 text-center">
          <p className="text-body text-fg-muted">{t("overviewError")}</p>
          <Button size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      ) : total === 0 ? (
        <p className="grid min-h-60 place-content-center rounded-lg border border-dashed border-line p-4 text-center text-body text-fg-muted">{t("noTrendMerges")}</p>
      ) : (
        <div className="min-w-0 text-fg-subtle [--ts-chart-tooltip-background:var(--surface)] [--ts-chart-tooltip-border:1px_solid_var(--line-strong)] [--ts-chart-tooltip-color:var(--fg)] [--ts-chart-tooltip-shadow:var(--elevation-1)] [&_svg_text]:font-[family-name:var(--font-ui)]">
          <Chart definition={definition} height={240} ariaLabel={range ? `${t("mergeActivity")}, ${range}` : t("mergeActivity")} />
        </div>
      )}
    </section>
  );
}
