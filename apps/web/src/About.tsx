import { FolderGit2, Inbox, LineChart, RefreshCw, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { projectRepository, projectVersion } from "./project";
import { LinkButton, TextLink } from "./ui-controls";

const features: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Inbox, title: "aboutAttentionTitle", description: "aboutAttentionDescription" },
  { icon: LineChart, title: "aboutOverviewTitle", description: "aboutOverviewDescription" },
  { icon: RefreshCw, title: "aboutSyncTitle", description: "aboutSyncDescription" },
];

// Reachable signed out as well as signed in, so it depends on nothing but the bundle: no query, no session. One readable column, widths measured against @container/dashboard like every other page.
export function About() {
  const { t } = useTranslation();
  const featuresId = useId();
  const startId = useId();
  return (
    <article className="mx-auto grid w-full max-w-[40rem] min-w-0 gap-8 pt-2 pb-10 @row/dashboard:pt-6">
      <header className="grid min-w-0 gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-12 shrink-0" />
          <div className="grid min-w-0 gap-0.5">
            <h1 className="text-page font-semibold tracking-[var(--tracking-page)] text-fg">{t("pages.aboutTitle")}</h1>
            <p className="text-small text-fg-subtle tabular-nums">{t("pages.version", { version: projectVersion })}</p>
          </div>
        </div>
        <p className="text-title font-medium text-fg">{t("aboutTagline")}</p>
        <p className="text-body text-fg-muted">{t("aboutDescription")}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <LinkButton href={projectRepository} external newTabLabel={t("pages.newTab")} icon={FolderGit2}>
            {t("aboutRepository")}
          </LinkButton>
          <TextLink href={projectRepository} external externalIcon={false} newTabLabel={t("pages.newTab")} tone="muted" className="min-w-0 text-small break-all">
            {projectRepository}
          </TextLink>
        </div>
      </header>
      <section aria-labelledby={featuresId} className="grid min-w-0 gap-4">
        <h2 id={featuresId} className="text-title font-semibold text-fg">
          {t("aboutFeatures")}
        </h2>
        <dl className="m-0 grid min-w-0 gap-4">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="grid min-w-0 gap-1">
              <dt className="flex items-center gap-2.5 text-body font-semibold text-fg">
                <span aria-hidden="true" className="inline-grid size-7 shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-text">
                  <Icon size={15} />
                </span>
                {t(title)}
              </dt>
              <dd className="m-0 pl-[2.375rem] text-body text-fg-muted">{t(description)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby={startId} className="grid min-w-0 gap-2 rounded-lg border border-line bg-bg-subtle p-4 @pair/dashboard:p-5">
        <h2 id={startId} className="text-title font-semibold text-fg">
          {t("aboutGettingStartedTitle")}
        </h2>
        <p className="text-body text-fg-muted">{t("aboutGettingStartedDescription")}</p>
      </section>
    </article>
  );
}
