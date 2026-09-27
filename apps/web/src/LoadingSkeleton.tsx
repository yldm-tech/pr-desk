import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { cx } from "./ui-controls";
import type { Destination } from "./routes";
import { itemTracks, type ItemTracks } from "./ui-list";

// Placeholders are drawn on the same grids and at the same heights as the content they stand in for, so the page keeps its shape when the data lands instead of shoving everything below it. Every one is a single status region named "Loading…" with its shapes hidden from assistive technology. The .react-loading-skeleton class they render is also what the layout suite waits on before it measures a page.
function LoadingFrame({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <SkeletonTheme baseColor="var(--skeleton-base)" highlightColor="var(--skeleton-highlight)">
      <div className={className} role="status" aria-label={t("loading")} aria-busy="true">
        <div aria-hidden="true">{children}</div>
      </div>
    </SkeletonTheme>
  );
}

// One list, table or repository row, on the row's own tracks. The widths vary by index so a column of placeholders does not read as a single block.
function RowShape({ tracks, index }: { tracks: ItemTracks; index: number }) {
  const wide = index % 2 ? "82%" : "64%";
  if (tracks === "list")
    return (
      <div className={cx("grid min-h-11 items-start gap-x-1 gap-y-1 border-b border-line px-3 py-2.5 last:border-b-0", itemTracks[tracks])}>
        <Skeleton circle width={16} height={16} containerClassName="block pt-0.5" />
        <div className="col-start-2 row-start-1 grid min-w-0 gap-1.5 @row/list:row-end-3">
          <Skeleton width={wide} height={14} />
          <Skeleton width="46%" height={11} />
          <Skeleton width="72%" height={11} />
        </div>
        <Skeleton width={28} height={12} containerClassName="col-start-3 row-start-1 justify-self-end" />
        <div className="col-start-2 col-end-4 row-start-2 flex gap-2 @row/list:col-start-3 @row/list:justify-self-end">
          <Skeleton width={84} height={28} />
          <Skeleton width={28} height={28} />
        </div>
      </div>
    );
  if (tracks === "repo")
    return (
      <div className={cx("grid min-h-11 items-center gap-x-3 border-b border-line px-3 py-3 last:border-b-0", itemTracks.repo)}>
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton circle width={16} height={16} />
          <Skeleton width={wide} height={14} containerClassName="min-w-0 flex-1" />
        </div>
        <Skeleton width={72} height={12} containerClassName="justify-self-end @row/dashboard:justify-self-start" />
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} width={24} height={14} containerClassName="hidden @table/dashboard:block" />
        ))}
      </div>
    );
  return (
    <div className={cx("grid min-h-11 items-start gap-x-3 border-b border-line px-3 py-2.5 last:border-b-0", itemTracks.table)}>
      <div className="flex min-w-0 items-start gap-2">
        <Skeleton circle width={16} height={16} />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Skeleton width={wide} height={14} />
          <Skeleton width="38%" height={11} />
        </div>
      </div>
      <Skeleton width={44} height={12} containerClassName="justify-self-end @row/dashboard:justify-self-start" />
      <Skeleton width="70%" height={12} containerClassName="hidden @row/dashboard:block" />
      <Skeleton width={96} height={20} containerClassName="hidden @row/dashboard:block" />
      <Skeleton width={36} height={12} containerClassName="hidden @row/dashboard:block" />
    </div>
  );
}

export function ItemRowSkeleton({ tracks = "list", count = 1 }: { tracks?: ItemTracks; count?: number }) {
  return (
    <LoadingFrame className={tracks === "list" ? "@container/list" : undefined}>
      {Array.from({ length: count }, (_, index) => (
        <RowShape key={index} tracks={tracks} index={index} />
      ))}
    </LoadingFrame>
  );
}

// The Inbox header summary: one sentence of counts and the breakdown bar under it.
export function SummarySkeleton() {
  return (
    <LoadingFrame className="grid gap-2">
      <Skeleton width="min(420px, 90%)" height={14} />
      <Skeleton height={6} borderRadius={9999} />
    </LoadingFrame>
  );
}

export function StatStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <LoadingFrame>
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-line p-4 @row/dashboard:grid-cols-4">
        {Array.from({ length: count }, (_, key) => (
          <div key={key} className="grid gap-1.5">
            <Skeleton width={72} height={28} />
            <Skeleton width="60%" height={12} />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <LoadingFrame className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton width={160} height={16} />
        <Skeleton width={140} height={32} />
      </div>
      <Skeleton height={height} />
    </LoadingFrame>
  );
}

// Label-over-control pairs, as the settings cards lay them out.
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <LoadingFrame className="grid gap-5 rounded-lg border border-line bg-bg-subtle p-4">
      <Skeleton width={180} height={16} />
      {Array.from({ length: fields }, (_, key) => (
        <div key={key} className="grid gap-1.5">
          <Skeleton width={120} height={12} />
          <Skeleton height={32} />
        </div>
      ))}
    </LoadingFrame>
  );
}

// Insights: the scope controls, the totals, the chart and the repository breakdown. `controls` is off for the report's own Suspense fallback, which sits under controls that are already on screen.
export function OverviewSkeleton({ controls = false }: { controls?: boolean }) {
  return (
    <div className="@container/overview grid gap-6">
      {controls && (
        <LoadingFrame className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} width={48} height={28} />
            ))}
          </div>
          <Skeleton width={220} height={32} />
        </LoadingFrame>
      )}
      <StatStripSkeleton />
      <ChartSkeleton />
      <LoadingFrame className="grid gap-3">
        <Skeleton width={140} height={16} />
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="grid gap-1.5">
            <Skeleton width={key % 2 ? "40%" : "55%"} height={12} />
            <Skeleton height={6} borderRadius={9999} />
          </div>
        ))}
      </LoadingFrame>
    </div>
  );
}

export function PRListSkeleton({ count = 6 }: { count?: number }) {
  return <ItemRowSkeleton tracks="table" count={count} />;
}

export function RepositorySkeleton({ count = 6 }: { count?: number }) {
  return <ItemRowSkeleton tracks="repo" count={count} />;
}

export function ProfileSkeleton() {
  return (
    <LoadingFrame className="grid gap-3">
      <div className="flex items-center gap-3">
        <Skeleton circle width={32} height={32} />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={11} />
        </div>
      </div>
      <Skeleton count={2} height={11} />
      <div className="flex gap-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} width={64} height={12} />
        ))}
      </div>
    </LoadingFrame>
  );
}

// The old activity dialog keeps its three headings while it loads, so the reader sees which sections are coming.
export function ActivitySkeleton() {
  const { t } = useTranslation();
  return (
    <LoadingFrame className="grid gap-6 py-4">
      {[t("comments"), t("reviewDiscussions"), t("ciChecks")].map((heading) => (
        <section key={heading} className="grid gap-2">
          <h3 className="text-body font-semibold text-fg">{heading}</h3>
          <Skeleton height={44} />
          <Skeleton height={44} width="86%" />
        </section>
      ))}
    </LoadingFrame>
  );
}

export function AccountSkeleton() {
  return (
    <LoadingFrame className="flex min-h-10 items-center gap-2">
      <Skeleton circle width={24} height={24} />
      <Skeleton width={72} height={12} />
    </LoadingFrame>
  );
}

// The page each destination draws while the session is checked and while its lazy chunk loads, in that page's own shape, so the real page lands where the placeholder stood.
export function PageSkeleton({ page }: { page: Destination }) {
  if (page === "insights") return <OverviewSkeleton controls />;
  if (page === "settings") return <FormSkeleton fields={4} />;
  if (page === "about")
    return (
      <LoadingFrame className="grid max-w-[65ch] gap-3">
        <Skeleton width="40%" height={24} />
        <Skeleton count={4} height={12} />
      </LoadingFrame>
    );
  const toolbar = (
    <LoadingFrame className="flex flex-wrap items-center gap-2">
      <Skeleton width="min(260px, 100%)" height={32} containerClassName="min-w-0 flex-1 basis-60" />
      {page !== "repos" && <Skeleton width="min(320px, 100%)" height={28} containerClassName="min-w-0 flex-1 basis-72" />}
    </LoadingFrame>
  );
  if (page === "inbox")
    return (
      <div className="grid gap-4">
        <SummarySkeleton />
        {toolbar}
        <ItemRowSkeleton tracks="list" count={4} />
      </div>
    );
  return (
    <div className="grid gap-4">
      {toolbar}
      {page === "repos" ? <RepositorySkeleton /> : <PRListSkeleton />}
    </div>
  );
}

export function SyncStatusSkeleton() {
  return (
    <LoadingFrame className="flex min-h-8 items-center">
      <Skeleton width={120} height={12} />
    </LoadingFrame>
  );
}
