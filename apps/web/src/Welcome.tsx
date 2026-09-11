import { ArrowRight, Check, GitPullRequest, Inbox, LayoutDashboard, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiURL } from "./api-url";
import { primaryAction } from "./action-styles";

// The container queries are written out rather than using the @max-[…] variant:
// that variant compiles to `width < 800px`, which excludes the boundary the
// `(max-width: 800px)` it replaces includes. Where two of them set the same
// property they are given non-overlapping ranges, because one variant does not
// reliably override another — the generated stylesheet decides the order.
const at800 = "[@container_dashboard_(max-width:800px)]:";
const between = "[@container_dashboard_(max-width:800px)_and_(min-width:481px)]:";
const at480 = "[@container_dashboard_(max-width:480px)]:";

export function Welcome() {
  const { t } = useTranslation();
  return (
    <section className={`mx-auto mt-12 mb-0 grid max-w-[1100px] grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-12 ${at800}mt-[22px] ${at800}grid-cols-1 ${at800}gap-[30px]`}>
      <div>
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--accent-text)]">
          <GitPullRequest size={15} aria-hidden="true" />
          {t("welcomeEyebrow")}
        </span>
        <h2 className={`mx-0 mt-[22px] mb-5 text-[clamp(30px,3.3vw,46px)] leading-[1.22] font-[650] tracking-[-1.5px] text-balance whitespace-pre-line ${between}text-[36px] ${between}tracking-[-1px] ${at480}text-[31px] ${at480}tracking-[-1px]`}>{t("welcomeHeadline")}</h2>
        <p className={`m-0 max-w-[470px] text-[15px] leading-[1.85] text-[var(--muted)] ${at800}max-w-none ${at480}text-[14px]`}>{t("welcomeDescription")}</p>
        <div className={`mx-0 mt-7 mb-[17px] flex flex-wrap items-center gap-[22px] ${at480}gap-4`}>
          <a className={primaryAction} href={apiURL + "/api/v1/auth/github"}>
            <GitPullRequest size={18} aria-hidden="true" />
            {t("connectGitHub")}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
          <Link className="inline-flex items-center gap-[7px] text-[13px] text-[var(--foreground)] no-underline hover:text-[var(--accent-text)]" to="/about">
            {t("welcomeLearnMore")}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <RefreshCw size={14} aria-hidden="true" />
          {t("welcomeSyncNote")}
        </span>
      </div>
      <div className={`min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_16px_42px_var(--shadow)] ${at800}w-full ${at800}max-w-[560px] ${at800}justify-self-center`} aria-label={t("welcomePreview")}>
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-[17px] text-[13px]">
          <img className="h-[22px] w-[22px]" src="/favicon.svg" alt="" />
          <strong>PR Desk</strong>
          <span className="ml-auto text-[10px] text-[var(--muted)]">{t("welcomePreview")}</span>
        </div>
        <div className="px-5 pt-1.5 pb-5">
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-[18px]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <Inbox size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="text-[12px] font-semibold">{t("navAttention")}</strong>
              <p className="mx-0 mt-1 mb-0 text-[11px] leading-[1.5] text-[var(--muted)]">{t("welcomeAttentionHint")}</p>
            </div>
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--accent)]" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-[18px]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <GitPullRequest size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="text-[12px] font-semibold">{t("navRepositories")}</strong>
              <p className="mx-0 mt-1 mb-0 text-[11px] leading-[1.5] text-[var(--muted)]">{t("welcomeRepositoryHint")}</p>
            </div>
            <Check size={17} className="text-[var(--muted)]" aria-hidden="true" />
          </div>
          <div className="pt-[18px]">
            <div className="flex flex-wrap items-center gap-[7px] text-[12px]">
              <LayoutDashboard size={17} aria-hidden="true" />
              <strong>{t("navOverview")}</strong>
              <span className="ml-auto text-[10px] text-[var(--muted)]">{t("welcomeContributionHint")}</span>
            </div>
            <div className="mt-[22px] flex h-[90px] items-end gap-[7px] border-b border-[var(--border)] [&>span:nth-last-child(-n+3)]:bg-[var(--accent)]" aria-hidden="true">
              {[28, 46, 38, 61, 52, 76, 69, 87, 72, 94, 82, 100].map((height, index) => (
                <span key={index} className="flex-1 rounded-t-[3px] bg-[var(--accent-border)]" style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className={`col-span-full grid grid-cols-3 gap-7 border-t border-[var(--border)] pt-[30px] ${between}gap-5 ${at480}grid-cols-1 ${at480}gap-[22px]`}>
        {[
          { icon: Inbox, title: "welcomeFollowTitle", description: "welcomeFollowDescription" },
          { icon: LayoutDashboard, title: "welcomeExploreTitle", description: "welcomeExploreDescription" },
          { icon: RefreshCw, title: "welcomeUpdateTitle", description: "welcomeUpdateDescription" },
        ].map(({ icon: Icon, title, description }) => (
          <div key={title} className="grid grid-cols-[20px_1fr] content-start gap-[9px]">
            <Icon size={18} className="text-[var(--muted)]" aria-hidden="true" />
            <strong className="text-[13px] font-semibold">{t(title)}</strong>
            <p className="col-start-2 m-0 text-[12px] leading-[1.75] text-[var(--muted)]">{t(description)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
