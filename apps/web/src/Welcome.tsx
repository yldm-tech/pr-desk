import { ArrowRight, Check, GitPullRequest, Inbox, LayoutDashboard, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiURL } from "./api-url";
import { primaryAction } from "./action-styles";

// Every branch here is mobile-first and named after a container token, so each pair of adjacent bands shares a single edge and no width can fall between them — the hundredth-of-a-pixel ranges this file used to carry left (480.02px, 481px) matched by nothing at all. The hero stacks below `table` rather than below the old 800.02px because <main>'s content box is not monotonic in the viewport: the sidebar appearing at 900px costs 220px of content width, so an 800px container threshold made the hero two-column at a 832px window, stacked at 1000px and two-column again at 1061px.
//
// The classes are written out in full rather than held in a constant: Tailwind finds classes by scanning the source for complete names, and a prefix joined on at runtime produces a class it never writes a rule for.

export function Welcome() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto mt-[22px] mb-0 grid max-w-[1100px] grid-cols-1 items-center gap-[30px] @table/dashboard:mt-12 @table/dashboard:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @table/dashboard:gap-12">
      <div>
        <span className="inline-flex items-center gap-2 text-[length:0.75rem] font-medium text-[var(--accent-text)]">
          <GitPullRequest size={15} aria-hidden="true" />
          {t("welcomeEyebrow")}
        </span>
        <h2 className="mx-0 mt-[22px] mb-5 text-[length:1.9375rem] leading-[1.22] font-[650] tracking-[-1px] text-balance whitespace-pre-line @split/dashboard:text-[length:2.25rem] @table/dashboard:text-[clamp(1.875rem,3.3vw,2.875rem)] @table/dashboard:tracking-[-1.5px]">{t("welcomeHeadline")}</h2>
        <p className="m-0 max-w-none text-[length:0.875rem] leading-[1.85] text-[var(--muted)] @split/dashboard:text-[length:0.9375rem] @table/dashboard:max-w-[470px]">{t("welcomeDescription")}</p>
        <div className="mx-0 mt-7 mb-[17px] flex flex-wrap items-center gap-4 @split/dashboard:gap-[22px]">
          <a className={primaryAction} href={apiURL + "/api/v1/auth/github"}>
            <GitPullRequest size={18} aria-hidden="true" />
            {t("connectGitHub")}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
          <Link className="inline-flex items-center gap-[7px] text-[length:0.8125rem] text-[var(--foreground)] no-underline hover:text-[var(--accent-text)]" to="/about">
            {t("welcomeLearnMore")}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <span className="flex items-center gap-1.5 text-[length:0.6875rem] text-[var(--muted)]">
          <RefreshCw size={14} aria-hidden="true" />
          {t("welcomeSyncNote")}
        </span>
      </div>
      <div className="w-full max-w-[560px] min-w-0 justify-self-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_16px_42px_var(--shadow)] @table/dashboard:w-auto @table/dashboard:max-w-none @table/dashboard:justify-self-auto" aria-label={t("welcomePreview")}>
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-[17px] text-[length:0.8125rem]">
          <img className="h-[22px] w-[22px]" src="/favicon.svg" alt="" />
          <strong>PR Desk</strong>
          <span className="ml-auto text-[length:0.625rem] text-[var(--muted)]">{t("welcomePreview")}</span>
        </div>
        <div className="px-5 pt-1.5 pb-5">
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-[18px]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <Inbox size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="text-[length:0.75rem] font-semibold">{t("navAttention")}</strong>
              <p className="mx-0 mt-1 mb-0 text-[length:0.6875rem] leading-[1.5] text-[var(--muted)]">{t("welcomeAttentionHint")}</p>
            </div>
            <span className="h-[7px] w-[7px] rounded-[50%] bg-[var(--accent)]" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] py-[18px]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <GitPullRequest size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="text-[length:0.75rem] font-semibold">{t("navRepositories")}</strong>
              <p className="mx-0 mt-1 mb-0 text-[length:0.6875rem] leading-[1.5] text-[var(--muted)]">{t("welcomeRepositoryHint")}</p>
            </div>
            <Check size={17} className="text-[var(--muted)]" aria-hidden="true" />
          </div>
          <div className="pt-[18px]">
            <div className="flex flex-wrap items-center gap-[7px] text-[length:0.75rem]">
              <LayoutDashboard size={17} aria-hidden="true" />
              <strong>{t("navOverview")}</strong>
              <span className="ml-auto text-[length:0.625rem] text-[var(--muted)]">{t("welcomeContributionHint")}</span>
            </div>
            <div className="mt-[22px] flex h-[90px] items-end gap-[7px] border-b border-[var(--border)] [&>span:nth-last-child(-n+3)]:bg-[var(--accent)]" aria-hidden="true">
              {[28, 46, 38, 61, 52, 76, 69, 87, 72, 94, 82, 100].map((height, index) => (
                <span key={index} className="flex-1 rounded-t-[3px] bg-[var(--accent-border)]" style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="col-span-full grid grid-cols-1 gap-[22px] border-t border-[var(--border)] pt-[30px] @split/dashboard:grid-cols-3 @split/dashboard:gap-5 @table/dashboard:gap-7">
        {[
          { icon: Inbox, title: "welcomeFollowTitle", description: "welcomeFollowDescription" },
          { icon: LayoutDashboard, title: "welcomeExploreTitle", description: "welcomeExploreDescription" },
          { icon: RefreshCw, title: "welcomeUpdateTitle", description: "welcomeUpdateDescription" },
        ].map(({ icon: Icon, title, description }) => (
          <div key={title} className="grid grid-cols-[20px_1fr] content-start gap-[9px]">
            <Icon size={18} className="text-[var(--muted)]" aria-hidden="true" />
            <strong className="text-[length:0.8125rem] font-semibold">{t(title)}</strong>
            <p className="col-start-2 m-0 text-[length:0.75rem] leading-[1.75] text-[var(--muted)]">{t(description)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
