import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Chart } from "@tanstack/charts/react";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { tooltip } from "@tanstack/charts/tooltip";

// `color` is a resolved colour value (see useThemeColors), `share` is already formatted for the tooltip.
export type DonutSlice = { key: string; label: string; value: number; color: string; share: string };

// A ring of shares, drawn beside the list that prints every value, so the ring is the picture and the list stays the text a screen reader and a colour-blind reader use. Hovering a slice names it with its count and share. Slices of zero are left out: an arc of nothing only adds a gap.
export function Donut({ slices, ariaLabel, nameLabel }: { slices: DonutSlice[]; ariaLabel: string; nameLabel: string }) {
  const { t } = useTranslation();
  const shown = useMemo(() => slices.filter((slice) => slice.value > 0), [slices]);
  const definition = useMemo(
    () =>
      defineChart({
        marks: [polar({ inset: 3, marks: [radialArc(pie(shown, { value: "value", gapAngle: 0.03 }), { innerRadius: ({ radius }) => radius * 0.72, cornerRadius: 2, fill: (d) => d.color, key: "key" })], scales: { angle: null, radius: null } })],
        scales: { x: null, y: null },
        tooltip: {
          use: tooltip,
          items: [
            { field: "label", label: nameLabel },
            { field: "value", label: t("insights.prsColumn") },
            { field: "share", label: t("contributionShare") },
          ],
        },
      }),
    [shown, nameLabel, t],
  );
  if (shown.length === 0) return null;
  return (
    <div className="size-36 shrink-0 [--ts-chart-tooltip-background:var(--surface)] [--ts-chart-tooltip-border:1px_solid_var(--line-strong)] [--ts-chart-tooltip-color:var(--fg)] [--ts-chart-tooltip-shadow:var(--elevation-1)]">
      <Chart definition={definition} height={144} ariaLabel={ariaLabel} />
    </div>
  );
}
