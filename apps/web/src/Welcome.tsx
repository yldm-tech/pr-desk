import { ArrowRight, Check, GitPullRequest, Inbox, LayoutDashboard, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiURL } from "./api-url";

export function Welcome() {
  const { t } = useTranslation();
  return (
    <section className="welcome-layout">
      <div className="welcome-intro">
        <span className="welcome-eyebrow">
          <GitPullRequest size={15} aria-hidden="true" />
          {t("welcomeEyebrow")}
        </span>
        <h2>{t("welcomeHeadline")}</h2>
        <p>{t("welcomeDescription")}</p>
        <div className="welcome-actions">
          <a className="primary-action" href={apiURL + "/api/v1/auth/github"}>
            <GitPullRequest size={18} aria-hidden="true" />
            {t("connectGitHub")}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
          <Link className="welcome-about" to="/about">
            {t("welcomeLearnMore")}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <span className="welcome-note">
          <RefreshCw size={14} aria-hidden="true" />
          {t("welcomeSyncNote")}
        </span>
      </div>
      <div className="welcome-preview" aria-label={t("welcomePreview")}>
        <div className="welcome-preview-heading">
          <img src="/favicon.svg" alt="" />
          <strong>PR Desk</strong>
          <span>{t("welcomePreview")}</span>
        </div>
        <div className="welcome-preview-body">
          <div className="welcome-preview-row">
            <span className="welcome-feature-icon">
              <Inbox size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>{t("navAttention")}</strong>
              <p>{t("welcomeAttentionHint")}</p>
            </div>
            <span className="welcome-status-dot" aria-hidden="true" />
          </div>
          <div className="welcome-preview-row">
            <span className="welcome-feature-icon">
              <GitPullRequest size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>{t("navRepositories")}</strong>
              <p>{t("welcomeRepositoryHint")}</p>
            </div>
            <Check size={17} className="text-[var(--muted)]" aria-hidden="true" />
          </div>
          <div className="welcome-preview-chart">
            <div>
              <LayoutDashboard size={17} aria-hidden="true" />
              <strong>{t("navOverview")}</strong>
              <span>{t("welcomeContributionHint")}</span>
            </div>
            <div className="welcome-bars" aria-hidden="true">
              {[28, 46, 38, 61, 52, 76, 69, 87, 72, 94, 82, 100].map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="welcome-benefits">
        {[
          { icon: Inbox, title: "welcomeFollowTitle", description: "welcomeFollowDescription" },
          { icon: LayoutDashboard, title: "welcomeExploreTitle", description: "welcomeExploreDescription" },
          { icon: RefreshCw, title: "welcomeUpdateTitle", description: "welcomeUpdateDescription" },
        ].map(({ icon: Icon, title, description }) => (
          <div key={title}>
            <Icon size={18} aria-hidden="true" />
            <strong>{t(title)}</strong>
            <p>{t(description)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
