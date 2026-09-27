import { CircleCheck, GitMerge } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import type { InboxSummary as Summary } from "./followup-view";
import { SummarySkeleton } from "./LoadingSkeleton";
import { cx } from "./ui-controls";

type Part = { key: string; visible: string; name?: string; to: string; params: Record<string, string>; tone?: "blocked" };

// The sentence at the top of the Inbox: how much there is to do and where it comes from, each part a link to exactly the rows it counts. It ignores the page's own filters, like the tiles it replaces did, so the numbers do not shrink while the reader narrows the list below. A part whose count is zero is left out rather than printed as "0 to review".
// The bar under it is the same breakdown drawn once more for the eye, in the order the sentence reads; it is hidden from assistive technology because every number in it is already said in words.
export function InboxSummary({ summary }: { summary: Summary | undefined }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  if (!summary) return <SummarySkeleton />;
  // A link is "current" when the page is showing exactly what it counts, so the reader can see which part of the sentence the list below is.
  const defaults: Record<string, string> = { role: "all", status: "todo" };
  const current = (wanted: Record<string, string>) => ["role", "status", "tone", "merged", "ready", "repo", "q"].every((key) => (params.get(key) || defaults[key] || "") === (wanted[key] ?? defaults[key] ?? ""));
  const blocked = Math.min(summary.blocked, summary.authored);
  const parts: Part[] = [
    { key: "todo", visible: t("inbox.toDo", { count: summary.total }), name: t("inbox.linkToDo", { count: summary.total }), to: "/inbox?status=todo", params: { status: "todo" } },
    { key: "blocked", visible: t("inbox.blockedCount", { count: summary.blocked }), name: t("inbox.linkBlocked", { count: summary.blocked }), to: "/inbox?status=todo&tone=blocked", params: { status: "todo", tone: "blocked" }, tone: "blocked" },
    { key: "authored", visible: t("inbox.onYourPRs", { count: summary.authored }), name: t("inbox.linkAuthored", { count: summary.authored }), to: "/inbox?role=authored&status=action", params: { role: "authored", status: "action" } },
    { key: "reviewer", visible: t("inbox.toReview", { count: summary.reviewer }), name: t("inbox.linkReviewer", { count: summary.reviewer }), to: "/inbox?role=reviewer&status=action", params: { role: "reviewer", status: "action" } },
    { key: "follow_up", visible: t("inbox.toFollowUp", { count: summary.followUp }), name: t("inbox.linkFollowUp", { count: summary.followUp }), to: "/inbox?status=follow_up", params: { status: "follow_up" } },
  ];
  const counts: Record<string, number> = { todo: summary.total, blocked: summary.blocked, authored: summary.authored, reviewer: summary.reviewer, follow_up: summary.followUp };
  const shown = parts.filter((part) => counts[part.key] > 0);
  const segments = [
    { key: "blocked", value: blocked, fill: "bg-tone-blocked" },
    { key: "authored", value: summary.authored - blocked, fill: "bg-tone-action" },
    { key: "reviewer", value: summary.reviewer, fill: "bg-tone-waiting" },
    { key: "follow_up", value: summary.followUp, fill: "bg-tone-neutral" },
  ].filter((segment) => segment.value > 0);
  const chips: { key: string; count: number; icon: typeof CircleCheck; visible: string; name: string; to: string; params: Record<string, string>; tone: string }[] = [
    { key: "ready", count: summary.ready, icon: CircleCheck, visible: t("inbox.readyCount", { count: summary.ready }), name: t("inbox.linkReady", { count: summary.ready }), to: "/inbox?status=all&ready=1", params: { status: "all", ready: "1" }, tone: "text-tone-ready border-tone-ready-line" },
    {
      key: "merged",
      count: summary.recentMerged,
      icon: GitMerge,
      visible: t("inbox.recentMergedCount", { count: summary.recentMerged }),
      name: t("inbox.linkRecentMerged", { count: summary.recentMerged }),
      to: "/inbox?status=archived&merged=1",
      params: { status: "archived", merged: "1" },
      tone: "text-fg-muted border-line-strong",
    },
  ];
  const shownChips = chips.filter((chip) => chip.count > 0);
  return (
    <nav aria-label={t("inbox.summaryLabel")} className="grid min-w-0 gap-2.5">
      {shown.length > 0 && (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-body text-fg-muted">
          {shown.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 && (
                <span aria-hidden="true" className="text-fg-subtle">
                  ·
                </span>
              )}
              <Link
                to={part.to}
                aria-current={current(part.params) ? "true" : undefined}
                className={cx("rounded-sm no-underline decoration-1 underline-offset-2 hover:underline aria-[current=true]:font-medium aria-[current=true]:text-fg aria-[current=true]:underline", index === 0 ? "font-medium text-fg" : part.tone === "blocked" ? "text-tone-blocked" : "text-fg-muted hover:text-fg")}
              >
                <span aria-hidden="true">{part.visible}</span>
                <span className="sr-only">{part.name}</span>
              </Link>
            </Fragment>
          ))}
        </p>
      )}
      {summary.total > 0 && segments.length > 0 && (
        <div aria-hidden="true" data-segments className="flex h-1.5 w-full max-w-xl gap-0.5 overflow-hidden rounded-full">
          {segments.map((segment) => (
            <span key={segment.key} data-segment className={cx("h-full min-w-1 rounded-full", segment.fill)} style={{ flexGrow: segment.value }} />
          ))}
        </div>
      )}
      {shownChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {shownChips.map((chip) => {
            const Icon = chip.icon;
            return (
              <Link
                key={chip.key}
                to={chip.to}
                aria-current={current(chip.params) ? "true" : undefined}
                className={cx("inline-flex min-h-6 items-center gap-1.5 rounded-full border bg-transparent px-2.5 text-caption font-medium no-underline hover:bg-bg-muted aria-[current=true]:bg-bg-muted pointer-coarse:min-h-11 pointer-coarse:px-3.5", chip.tone)}
              >
                <Icon size={12} strokeWidth={2.25} aria-hidden="true" className="shrink-0" />
                <span aria-hidden="true">{chip.visible}</span>
                <span className="sr-only">{chip.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
