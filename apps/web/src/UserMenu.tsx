import { apiURL } from "./api-url";
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  X,
  MapPin,
  Building2,
  CalendarDays,
  LogOut,
  UserRound,
} from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { ProfileSkeleton } from "./LoadingSkeleton";

const profileSchema = z.object({
  login: z.string(),
  name: z.string(),
  avatar_url: z.string(),
  bio: z.string(),
  company: z.string(),
  location: z.string(),
  created_at: z.string(),
  followers: z.number(),
  following: z.number(),
  public_repos: z.number(),
});

export function UserMenu({
  connected,
  username,
  onDisconnect,
  disconnecting,
  disconnectError,
}: {
  connected: boolean;
  username?: string;
  onDisconnect: () => void;
  disconnecting: boolean;
  disconnectError: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const profile = useQuery({
    queryKey: ["profile", username],
    enabled: connected && open,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/profile", { credentials: "include", signal })
        .json()
        .then((data) => profileSchema.parse(data)),
    staleTime: 300000,
  });
  const user = profile.data;
  const login = user?.login || username;
  const href = login ? `https://github.com/${encodeURIComponent(login)}` : "";
  if (!connected)
    return (
      <a className="connectbtn" href={apiURL + "/api/v1/auth/github"}>
        {t("connectGitHub")}
      </a>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="account-trigger"
        aria-label={t("personalProfile")}
      >
        <Avatar login={login} />
        <span>{user?.name || login}</span>
        <ChevronDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="profile-popover"
          align="end"
          sideOffset={10}
          collisionPadding={16}
          aria-label={t("personalProfile")}
        >
          <div className="profile-heading">
            <strong>{t("personalProfile")}</strong>
            <Popover.Close className="profile-close" aria-label={t("close")}>
              <X size={17} />
            </Popover.Close>
          </div>
          {profile.isPending ? (
            <ProfileSkeleton/>
          ) : profile.isError ? (
            <div role="alert">
              <p>{t("profileError")}</p>
              <button
                className="profile-retry"
                onClick={() => profile.refetch()}
              >
                {t("retry")}
              </button>
            </div>
          ) : (
            user && (
              <>
                <a
                  className="profile-identity"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Avatar login={login} />
                  <span>
                    <strong>{user.name || user.login}</strong>
                    <small>@{user.login}</small>
                  </span>
                </a>
                {user.bio && <p className="profile-bio">{user.bio}</p>}
                <div className="profile-metadata">
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
                    {t("joinedGitHub", {
                      date: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                        year: "numeric",
                        month: "short",
                        timeZone: "UTC",
                      }).format(new Date(user.created_at)),
                    })}
                  </p>
                </div>
                <div className="profile-stats">
                  {[
                    [user.followers, "followers", "?tab=followers"],
                    [user.following, "following", "?tab=following"],
                    [user.public_repos, "publicOnly", "?tab=repositories"],
                  ].map(([count, key, suffix]) => (
                    <a
                      key={key}
                      href={href + suffix}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>
                        {Number(count).toLocaleString(i18n.resolvedLanguage)}
                      </strong>
                      <span>{t(String(key))}</span>
                    </a>
                  ))}
                </div>
                <a
                  className="profile-github"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("viewGitHubProfile")}
                </a>
              </>
            )
          )}
          <button
            className="profile-disconnect"
            disabled={disconnecting}
            onClick={onDisconnect}
          >
            <LogOut size={15} />
            {t("disconnect")}
          </button>
          {disconnectError && <p role="alert">{t("apiUnavailable")}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
function Avatar({ login }: { login?: string }) {
  const [failed, setFailed] = useState(false);
  return login && !failed ? (
    <img
      className="account-avatar"
      src={`https://github.com/${encodeURIComponent(login)}.png?size=96`}
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="account-avatar account-avatar-fallback">
      <UserRound size={20} />
    </span>
  );
}
