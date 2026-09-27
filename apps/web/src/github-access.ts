import type React from "react";
import { useEffect } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { useSyncMutation } from "./queries";

// Opens the GitHub App installation in a centred popup rather than a tab, so finishing it returns the reader to the page that asked. A modifier click is left to the browser, which is how "open in a new tab" and "new window" keep working; a blocked popup falls back to the link's own target. `opener` is cleared before navigating so github.com never holds a handle on this window.
export function openInstallPopup(event: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const width = Math.min(760, window.screen.availWidth);
  const height = Math.min(820, window.screen.availHeight);
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open("about:blank", "_blank", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (!popup) return;
  event.preventDefault();
  popup.opener = null;
  popup.location.href = href;
  popup.focus();
}

export const repositoryAccessSchema = z.object({ has_installations: z.boolean(), can_read_private: z.boolean().optional(), install_url: z.string().optional(), installations: z.array(z.object({ account: z.string(), repository_selection: z.string(), can_read_prs: z.boolean(), settings_url: z.string() })).optional() });
export type RepositoryAccess = z.infer<typeof repositoryAccessSchema>;
export type Installation = NonNullable<RepositoryAccess["installations"]>[number];

// Whether private repositories are out of reach: no installation at all, or installations that may not read pull requests. An answer that has not arrived yet is not "missing".
export function privateAccessMissing(access: RepositoryAccess | undefined): boolean {
  return access?.can_read_private === false || access?.has_installations === false;
}

// Where "Install GitHub App" goes. The API answers with the app's own installation page when GITHUB_APP_SLUG is set; without a slug there is no app page to offer, and GitHub's list of installations is where an existing one is managed. Before the access check has answered, the API's redirect endpoint stands in, since it resolves to the same page once the server knows its slug.
export function installHref(access: RepositoryAccess | undefined): string {
  if (!access) return apiURL + "/api/v1/repository-access/install";
  return access.install_url || "https://github.com/settings/installations";
}

// The facts about an installation set that decide what a sync can read: whether any installation may read pull requests, and each account's selection and permission. Settings URLs and ordering are left out, so a refetch that only reorders the list is not a change.
export function accessFingerprint(access: RepositoryAccess): string {
  const installations = (access.installations ?? []).map(({ account, repository_selection, can_read_prs }) => ({ account, repository_selection, can_read_prs })).sort((a, b) => a.account.localeCompare(b.account));
  return JSON.stringify({ readable: access.can_read_private ?? false, installations });
}

// Decides when newly granted access is worth a full sync. The first answer only records where access stands, because arriving at a page is not a grant; after that, an answer whose fingerprint differs from the last one fires once, and only when it can read private repositories. Every caller of one watcher shares the last fingerprint, so two pages reading the same answer never start two syncs.
export function createAccessWatcher(): (access: RepositoryAccess) => boolean {
  let last: string | undefined;
  return (access) => {
    const current = accessFingerprint(access);
    const changed = last !== undefined && last !== current;
    last = current;
    return changed && access.can_read_private === true;
  };
}

// One watcher for the page session, shared by every mount of useRepositoryAccess, so Insights and Settings both being on screen still means one full sync per grant.
const observeAccess = createAccessWatcher();

// The installation check behind Insights' private scope and Settings › GitHub access. Its key, retry and staleness are the ones the Overview query always had: stale at once, so coming back from the installation popup and focusing the window rechecks straight away.
export function useRepositoryAccess(): UseQueryResult<RepositoryAccess> {
  const { mutate } = useSyncMutation();
  const query = useQuery({
    queryKey: ["repository-access"],
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/repository-access", { credentials: "include", signal, retry: 0 })
        .json()
        .then((value) => repositoryAccessSchema.parse(value)),
    staleTime: 0,
  });
  const { data } = query;
  useEffect(() => {
    // A newly granted installation can read private repositories the last sync skipped, so the grant starts a full sync.
    if (data && observeAccess(data)) mutate(true);
  }, [data, mutate]);
  return query;
}
