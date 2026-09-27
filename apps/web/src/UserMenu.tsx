import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Building2, CalendarDays, ChevronsUpDown, Info, LogOut, MapPin, Monitor, Moon, Settings2, Sun, type LucideIcon } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { projectRepository, projectVersion } from "./project";
import { ProfileSkeleton } from "./LoadingSkeleton";
import { LanguageSelect } from "./LanguageMenu";
import { paths } from "./routes";
import { useTheme, type ThemePref } from "./theme";
import { Button, cx, IconButton, SegmentedControl, TextLink } from "./ui-controls";
import { Avatar } from "./ui-display";
import { Popover } from "./ui-overlay";

const profileSchema = z.object({ login: z.string(), name: z.string(), avatar_url: z.string(), bio: z.string(), company: z.string(), location: z.string(), created_at: z.string(), followers: z.number(), following: z.number(), public_repos: z.number() });

const themes: ThemePref[] = ["system", "light", "dark"];
const themeKey: Record<ThemePref, string> = { system: "shell.themeSystem", light: "shell.themeLight", dark: "shell.themeDark" };
const themeIcon: Record<ThemePref, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

// The theme choice. `full` is the three pressed buttons the account menu has room for; `compact` is one button for the signed-out top bar that steps through the same three choices and says which one is current in its name.
export function ThemeSwitch({ variant = "full" }: { variant?: "full" | "compact" }) {
  const { t } = useTranslation();
  const { pref, setPref } = useTheme();
  if (variant === "compact") {
    const next = themes[(themes.indexOf(pref) + 1) % themes.length];
    return <IconButton label={t("shell.themeCurrent", { theme: t(themeKey[pref]) })} icon={themeIcon[pref]} onClick={() => setPref(next)} />;
  }
  return <SegmentedControl label={t("shell.theme")} size="sm" value={pref} onChange={setPref} items={themes.map((value) => ({ value, label: t(themeKey[value]) }))} />;
}

// One row of the menu: a label on the left and its control on the right, wrapping under each other when a translation is long.
function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-small font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

const menuLink = "flex min-h-8 items-center gap-2 rounded-md px-2 text-body text-fg no-underline hover:bg-bg-muted pointer-coarse:min-h-11";

// The account menu behind the avatar: who is signed in, the two preferences that belong to the reader rather than to a page (theme and language), the routes that are not destinations (Settings, About), and Disconnect. The profile is fetched only while the menu is open, since nothing else on screen needs it.
export function AccountMenu({ username, onDisconnect, disconnecting, disconnectError, align }: { username?: string; onDisconnect: () => void; disconnecting: boolean; disconnectError: boolean; align: "start" | "end" }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const profile = useQuery({
    queryKey: ["profile", username],
    enabled: open,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/profile", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => profileSchema.parse(data)),
    staleTime: 300000,
  });
  const user = profile.data;
  const login = user?.login || username || "";
  const href = login ? `https://github.com/${encodeURIComponent(login)}` : "";
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const close = () => setOpen(false);
  const newTab = t("shell.newTab");
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      label={t("personalProfile")}
      className="grid w-[min(320px,calc(100vw-32px))] gap-3 p-3"
      trigger={
        <button
          type="button"
          className={cx(
            "inline-flex min-h-8 min-w-8 shrink-0 items-center gap-2 rounded-md border-0 bg-transparent p-1 text-body text-fg transition-colors duration-[var(--dur-fast)] hover:bg-bg-muted data-[state=open]:bg-bg-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            "justify-center shell:w-full shell:min-w-0 shell:justify-start shell:px-2",
          )}
        >
          <Avatar login={login} size={24} />
          <span className="sr-only">{t("shell.account")}: </span>
          <span className="sr-only min-w-0 flex-1 truncate text-left font-medium shell:not-sr-only">{login}</span>
          <ChevronsUpDown size={14} aria-hidden="true" className="hidden shrink-0 text-fg-subtle shell:block" />
        </button>
      }
    >
      <h2 className="sr-only">{t("personalProfile")}</h2>
      {profile.isPending ? (
        <ProfileSkeleton />
      ) : profile.isError ? (
        <div role="alert" className="grid justify-items-start gap-2 text-small text-fg-muted">
          <p>{t("profileError")}</p>
          <Button size="sm" onClick={() => void profile.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        user && (
          <div className="grid gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar login={login} size={32} />
              <div className="grid min-w-0">
                <strong className="truncate text-body font-semibold text-fg">{user.name || user.login}</strong>
                <TextLink href={href} external newTabLabel={newTab} tone="muted" className="truncate text-small">
                  @{user.login}
                </TextLink>
              </div>
            </div>
            {user.bio && <p className="text-small text-fg-muted">{user.bio}</p>}
            <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-caption text-fg-muted">
              {user.company && (
                <li className="inline-flex min-w-0 items-center gap-1">
                  <Building2 size={12} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{user.company}</span>
                </li>
              )}
              {user.location && (
                <li className="inline-flex min-w-0 items-center gap-1">
                  <MapPin size={12} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{user.location}</span>
                </li>
              )}
              <li className="inline-flex items-center gap-1">
                <CalendarDays size={12} aria-hidden="true" className="shrink-0" />
                {t("joinedGitHub", { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { year: "numeric", month: "short", timeZone: "UTC" }).format(new Date(user.created_at)) })}
              </li>
            </ul>
            <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-caption">
              {(
                [
                  [user.followers, "followers", "?tab=followers"],
                  [user.following, "following", "?tab=following"],
                  [user.public_repos, "publicRepositories", "?tab=repositories"],
                ] as const
              ).map(([count, key, suffix]) => (
                <li key={key}>
                  <TextLink href={href + suffix} external externalIcon={false} newTabLabel={newTab} tone="muted">
                    <strong className="font-semibold text-fg tabular-nums">{number.format(count)}</strong> {t(key)}
                  </TextLink>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      <div className="grid gap-2.5 border-t border-line pt-3">
        <MenuRow label={t("shell.theme")}>
          <ThemeSwitch />
        </MenuRow>
        <LanguageSelect className="flex w-full flex-wrap justify-between" />
      </div>
      <div className="grid border-t border-line pt-2">
        <TextLink to={paths.settings} className={menuLink} onClick={close}>
          <Settings2 size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
          {t("followup.settings")}
        </TextLink>
        <TextLink to={paths.about} className={menuLink} onClick={close}>
          <Info size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
          {t("shell.aboutTitle")}
        </TextLink>
        {href && (
          <TextLink href={href} external newTabLabel={newTab} className={menuLink}>
            {t("viewGitHubProfile")}
          </TextLink>
        )}
      </div>
      <div className="grid gap-1 border-t border-line pt-2">
        <Button variant="danger" icon={LogOut} busy={disconnecting} onClick={onDisconnect} className="w-full justify-start">
          {t("disconnect")}
        </Button>
        {disconnectError && (
          <p role="alert" className="px-2 text-caption text-tone-blocked">
            {t("apiUnavailable")}
          </p>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 border-t border-line pt-2 text-caption text-fg-subtle">
        <span className="tabular-nums">{projectVersion}</span>
        <span aria-hidden="true">·</span>
        <TextLink href={projectRepository} external newTabLabel={newTab} tone="muted">
          {t("shell.source")}
        </TextLink>
      </p>
    </Popover>
  );
}
