import { apiURL } from "./api-url";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, X, MapPin, Building2, CalendarDays, LogOut, UserRound } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { ProfileSkeleton } from "./LoadingSkeleton";
import { accountAvatar, accountAvatarFallback, accountTrigger, profileBio, profileIdentity, profileMetadata, profilePopover, profileStats } from "./profile-styles";

const profileSchema = z.object({ login: z.string(), name: z.string(), avatar_url: z.string(), bio: z.string(), company: z.string(), location: z.string(), created_at: z.string(), followers: z.number(), following: z.number(), public_repos: z.number() });

export function UserMenu({ connected, username, onDisconnect, disconnecting, disconnectError }: { connected: boolean; username?: string; onDisconnect: () => void; disconnecting: boolean; disconnectError: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const profile = useQuery({
    queryKey: ["profile", username],
    enabled: connected && open,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/profile", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => profileSchema.parse(data)),
    staleTime: 300000,
  });
  const user = profile.data;
  const login = user?.login || username;
  const href = login ? `https://github.com/${encodeURIComponent(login)}` : "";
  if (!connected)
    return (
      <a
        className="inline-flex items-center rounded-[7px] bg-[var(--accent)] px-2.5 py-[7px] font-[inherit] text-[11px] font-semibold text-[var(--surface)] no-underline shadow-[0_1px_2px_var(--shadow)] hover:bg-[var(--accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        href={apiURL + "/api/v1/auth/github"}
      >
        {t("connectGitHub")}
      </a>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={`${accountTrigger} min-h-[38px] [@media(max-width:480px)]:min-h-9`} aria-label={t("personalProfile")}>
        <Avatar login={login} size="h-8 w-8" />
        <span>{user?.name || login}</span>
        <ChevronDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={profilePopover} align="end" sideOffset={10} collisionPadding={16} aria-label={t("personalProfile")}>
          <div className="mb-5 flex items-center justify-between text-[length:var(--text-heading)] font-semibold">
            <strong>{t("personalProfile")}</strong>
            <Popover.Close className="grid min-h-8 min-w-8 place-items-center rounded-md border-0 bg-transparent p-[3px] text-[var(--muted)] hover:bg-[var(--surface-muted)]" aria-label={t("close")}>
              <X size={17} />
            </Popover.Close>
          </div>
          {profile.isPending ? (
            <ProfileSkeleton />
          ) : profile.isError ? (
            <div role="alert">
              <p>{t("profileError")}</p>
              <button className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-[7px] text-[var(--accent-text)]" onClick={() => profile.refetch()}>
                {t("retry")}
              </button>
            </div>
          ) : (
            user && (
              <>
                <a className={profileIdentity} href={href} target="_blank" rel="noopener noreferrer">
                  <Avatar login={login} size="h-[52px] w-[52px]" />
                  <span>
                    <strong>{user.name || user.login}</strong>
                    <small>@{user.login}</small>
                  </span>
                </a>
                {user.bio && <p className={profileBio}>{user.bio}</p>}
                <div className={profileMetadata}>
                  {user.company && (
                    <p>
                      <Building2 size={14} />
                      {user.company}
                    </p>
                  )}
                  {user.location && (
                    <p>
                      <MapPin size={14} />
                      {user.location}
                    </p>
                  )}
                  <p>
                    <CalendarDays size={14} />
                    {t("joinedGitHub", { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { year: "numeric", month: "short", timeZone: "UTC" }).format(new Date(user.created_at)) })}
                  </p>
                </div>
                <div className={profileStats}>
                  {[
                    [user.followers, "followers", "?tab=followers"],
                    [user.following, "following", "?tab=following"],
                    [user.public_repos, "publicRepositories", "?tab=repositories"],
                  ].map(([count, key, suffix]) => (
                    <a key={key} href={href + suffix} target="_blank" rel="noopener noreferrer">
                      <strong>{Number(count).toLocaleString(i18n.resolvedLanguage)}</strong>
                      <span>{t(String(key))}</span>
                    </a>
                  ))}
                </div>
                <a className="mt-4 block rounded-[7px] border border-[var(--border)] bg-[var(--surface-muted)] p-[9px] text-center text-[var(--accent-text)] no-underline" href={href} target="_blank" rel="noopener noreferrer">
                  {t("viewGitHubProfile")}
                </a>
              </>
            )
          )}
          <button className="mx-0 mt-4 flex min-h-11 w-full items-center justify-center gap-2 border-0 border-t border-[var(--border)] bg-transparent px-0 pt-[15px] pb-0 text-[var(--danger)] [font:inherit] disabled:cursor-wait disabled:opacity-50" disabled={disconnecting} onClick={onDisconnect}>
            <LogOut size={15} />
            {t("disconnect")}
          </button>
          {disconnectError && <p role="alert">{t("apiUnavailable")}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
function Avatar({ login, size }: { login?: string; size: string }) {
  const [failed, setFailed] = useState(false);
  return login && !failed ? (
    <img className={`${accountAvatar} ${size}`} src={`https://github.com/${encodeURIComponent(login)}.png?size=96`} alt="" onError={() => setFailed(true)} />
  ) : (
    <span className={`${accountAvatarFallback} ${size}`}>
      <UserRound size={20} />
    </span>
  );
}
