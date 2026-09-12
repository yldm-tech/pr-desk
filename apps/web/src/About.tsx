import { secondaryAction } from "./action-styles";
import { ExternalLink, FolderGit2, GitPullRequest, Inbox, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { projectRepository, projectVersion } from "./project";

// This page lives inside <main>, so its width branches are measured against @container/dashboard. They used to be written with Tailwind's default sm and md prefixes, which this project clears from the breakpoint namespace — an unknown variant compiles to no rule at all rather than to an error, so neither the padding nor the three-up card grid actually changed at any width.
export function About() {
  const { t } = useTranslation();
  return (
    <article className="mx-auto grid max-w-5xl gap-5">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 @row/dashboard:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-12 w-12 rounded-xl" />
          <h2 className="text-2xl font-semibold tracking-tight">PR Desk</h2>
          <span className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]">{projectVersion}</span>
        </div>
        <p className="mt-6 max-w-2xl text-xl font-medium leading-relaxed">{t("aboutTagline")}</p>
        <p className="mt-3 max-w-3xl leading-relaxed text-[var(--muted)]">{t("aboutDescription")}</p>
        <a className={`${secondaryAction} mt-6 inline-flex max-w-full items-center gap-2`} href={projectRepository} target="_blank" rel="noopener noreferrer">
          <FolderGit2 size={18} aria-hidden="true" />
          {t("aboutRepository")}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <a className="mt-3 block w-fit max-w-full break-all text-sm text-[var(--muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--foreground)]" href={projectRepository} target="_blank" rel="noopener noreferrer">
          {projectRepository}
        </a>
      </section>
      <section aria-label={t("aboutFeatures")} className="grid gap-4 @row/dashboard:grid-cols-3">
        {[
          { icon: GitPullRequest, title: "aboutOverviewTitle", description: "aboutOverviewDescription" },
          { icon: Inbox, title: "aboutAttentionTitle", description: "aboutAttentionDescription" },
          { icon: RefreshCw, title: "aboutSyncTitle", description: "aboutSyncDescription" },
        ].map(({ icon: Icon, title, description }) => (
          <div key={title} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <Icon size={21} className="text-[var(--muted)]" aria-hidden="true" />
            <h3 className="mt-4 font-semibold">{t(title)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t(description)}</p>
          </div>
        ))}
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h3 className="font-semibold">{t("aboutGettingStartedTitle")}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">{t("aboutGettingStartedDescription")}</p>
      </section>
    </article>
  );
}
