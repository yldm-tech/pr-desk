import { ArrowRight, ChartColumn, CircleDot, GitPullRequest, RefreshCw, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiURL } from "./api-url";
import { resources } from "./i18n";
import { paths } from "./routes";
import { LinkButton, Select, TextLink } from "./ui-controls";

const blurbs: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: CircleDot, title: "welcomeFollowTitle", description: "welcomeFollowDescription" },
  { icon: RefreshCw, title: "welcomeUpdateTitle", description: "welcomeUpdateDescription" },
  { icon: ChartColumn, title: "welcomeExploreTitle", description: "welcomeExploreDescription" },
];

// What a signed-out visitor sees on every route but About: what the product does, one way in, and a language switch, in a single centred column. There is no preview of the app: the real thing is one click away, and a picture of it would go stale with every redesign.
export function Welcome() {
  const { t, i18n } = useTranslation();
  return (
    <section className="mx-auto grid w-full max-w-[36rem] min-w-0 justify-items-center gap-6 pt-6 pb-10 text-center @row/dashboard:pt-14">
      <div className="grid justify-items-center gap-2">
        <img className="size-12" src="/favicon.svg" alt="" />
        <p className="text-title font-semibold text-fg">PR Desk</p>
      </div>
      <div className="grid min-w-0 gap-3">
        <h1 className="text-page font-semibold tracking-[var(--tracking-page)] text-balance whitespace-pre-line text-fg @split/dashboard:text-display">{t("pages.welcomeHeadline")}</h1>
        <p className="text-body text-fg-muted @split/dashboard:text-title @split/dashboard:font-normal">{t("welcomeDescription")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        <LinkButton variant="primary" icon={GitPullRequest} href={apiURL + "/api/v1/auth/github"} className="min-h-10 px-4">
          {t("connectGitHub")}
        </LinkButton>
        <TextLink to={paths.about} className="inline-flex items-center gap-1 text-body font-medium">
          {t("welcomeLearnMore")}
          <ArrowRight size={14} aria-hidden="true" />
        </TextLink>
      </div>
      <p className="inline-flex items-center gap-1.5 text-caption text-fg-subtle">
        <RefreshCw size={12} aria-hidden="true" />
        {t("welcomeSyncNote")}
      </p>
      <ul className="m-0 grid w-full min-w-0 list-none gap-5 border-t border-line p-0 pt-6 text-left @split/dashboard:grid-cols-3 @split/dashboard:gap-4">
        {blurbs.map(({ icon: Icon, title, description }) => (
          <li key={title} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] content-start gap-x-3 gap-y-1 @split/dashboard:grid-cols-1">
            <span aria-hidden="true" className="row-span-2 inline-grid size-8 place-items-center rounded-md bg-accent-subtle text-accent-text @split/dashboard:row-span-1">
              <Icon size={16} />
            </span>
            <strong className="text-body font-semibold text-fg">{t(title)}</strong>
            <p className="text-small text-fg-muted">{t(description)}</p>
          </li>
        ))}
      </ul>
      {/* The only language switch a signed-out visitor needs on this page, as a native select: it is what every platform does best. */}
      <Select className="mt-2" label={t("language")} value={i18n.resolvedLanguage || "en"} onChange={(event) => void i18n.changeLanguage(event.target.value)} options={Object.keys(resources).map((code) => ({ value: code, label: t("nativeName", { lng: code }) }))} />
    </section>
  );
}
