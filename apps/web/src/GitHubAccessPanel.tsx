import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { apiURL } from "./api-url";
import { secondaryAction } from "./action-styles";
import { openInstallPopup } from "./github-access";

// The place the GitHub App installation lives. Until the full access panel lands it is the one control the sidebar has always offered — the install link, opened in the same centred popup — so any page that mounts it already gives the reader the way in.
export function GitHubAccessPanel({ variant }: { variant: "full" | "compact" }) {
  const { t } = useTranslation();
  const href = apiURL + "/api/v1/repository-access/install";
  return (
    <a className={`${secondaryAction} inline-flex max-w-full items-center gap-2`} data-variant={variant} href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => openInstallPopup(event, href)}>
      <Building2 size={16} aria-hidden="true" />
      <span>{t("organizationAccess")}</span>
    </a>
  );
}
