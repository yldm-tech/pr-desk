import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { KeyRound } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { Button } from "./ui-controls";
import { Badge, EmptyState, formatDate, Notice, StaleNotice } from "./ui-display";
import { ConfirmInline, Snippet } from "./ui-overlay";

// The endpoint an agent connects to is this deployment's own origin. apiURL is empty in production because the Go server serves the app, so the browser's location is the authoritative answer for both.
const serverOrigin = () => (apiURL || window.location.origin).replace(/\/$/, "");

const tokenSchema = z.object({ data: z.array(z.object({ id: z.number(), name: z.string(), client_id: z.string(), scopes: z.array(z.string()), created_at: z.string(), expires_at: z.string(), last_used_at: z.string().nullable() })) });
type IssuedToken = z.infer<typeof tokenSchema>["data"][number];

// The deprecated path exists because the deployment this page is about — a self-hosted instance over plain http — is not a secure context, so navigator.clipboard is not merely likely to fail there, it is absent. Without it every Copy button on the page is dead and the only offered recovery is selecting a horizontally scrolling <pre> by hand, which on a touch screen is not something a person can actually do. execCommand still works in insecure contexts. The textarea is positioned rather than hidden because a display:none or visibility:hidden element cannot hold a selection; it is readonly so a touch keyboard does not appear for the instant it is focused, and the focus is handed back to whatever had it so the Copy button keeps its ring.
function legacyCopy(value: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.readOnly = true;
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none";
  const previous = document.activeElement;
  document.body.append(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}

// navigator.clipboard is undefined outside a secure context, which a self-hosted instance served over plain http is, and a denied permission rejects. Both used to leave the button doing nothing at all, so the attempt reports its outcome.
export async function writeClipboard(value: string, clipboard: Clipboard | undefined = navigator.clipboard): Promise<boolean> {
  if (!clipboard) return legacyCopy(value);
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return legacyCopy(value);
  }
}

// One section of a settings tab: a bordered card on the subtle surface, its h2 and one line of context, the content, and an optional bar of actions underneath. Every Settings tab is built from it, the Reminders and Notifications tabs in FollowUpSettings.tsx included, which is why it lives in the module that file already imports.
export function SettingsCard({ title, titleId, description, children, footer, ref, tabIndex }: { title: string; titleId?: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; ref?: Ref<HTMLElement>; tabIndex?: number }) {
  return (
    <section ref={ref} tabIndex={tabIndex} className="min-w-0 rounded-lg border border-line bg-bg-subtle focus-visible:outline-offset-2">
      <div className="grid min-w-0 gap-4 p-4 @pair/dashboard:p-5">
        <header className="grid min-w-0 gap-1">
          <h2 id={titleId} className="text-title font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="text-small text-fg-muted">{description}</p>}
        </header>
        {children}
      </div>
      {footer && <div className="flex min-w-0 flex-wrap items-center gap-3 border-t border-line px-4 py-3 @pair/dashboard:px-5">{footer}</div>}
    </section>
  );
}

function IssuedTokens() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [revocations, setRevocations] = useState(0);
  // Revoking takes the focused button with it, so the card takes the focus instead of the document, and the result is announced.
  const [announcement, setAnnouncement] = useState({ text: "", id: 0 });
  const region = useRef<HTMLElement>(null);
  const announce = (text: string) => setAnnouncement((previous) => ({ text, id: previous.id + 1 }));
  useEffect(() => {
    if (announcement.id && document.activeElement === document.body) region.current?.focus();
  }, [announcement]);
  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/api-tokens", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => tokenSchema.parse(data)),
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: (id: number) => ky.delete(apiURL + `/api/v1/api-tokens/${id}`, { credentials: "include", retry: 0 }),
    onSuccess: () => {
      setRevocations((count) => count + 1);
      announce(t("access.announceRevoked"));
      void client.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });
  const when = (value: string | null) => (value ? formatDate(new Date(value), i18n.resolvedLanguage) : t("access.never"));
  const rows = tokens.data?.data || [];
  return (
    <SettingsCard ref={region} tabIndex={-1} title={t("access.tokens")} description={t("access.tokensHelp")}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.text}
      </p>
      {tokens.isError && tokens.data && <StaleNotice onRetry={() => void tokens.refetch()} />}
      {tokens.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <span className="sr-only" role="status">
            {t("loading")}
          </span>
          <Skeleton height={44} />
        </div>
      ) : tokens.isError && !tokens.data ? (
        <Notice
          tone="danger"
          role="alert"
          actions={
            <Button size="sm" onClick={() => void tokens.refetch()}>
              {t("followup.retry")}
            </Button>
          }
        >
          {t("access.tokensError")}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState icon={KeyRound} title={t("access.noTokens")} className="py-6" />
      ) : (
        <ul className="m-0 grid min-w-0 list-none rounded-md border border-line bg-surface p-0">
          {rows.map((token: IssuedToken) => (
            <li key={token.id} data-testid="issued-token" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-3 py-2.5 first:border-t-0">
              <div className="grid min-w-0 flex-1 basis-48 gap-1">
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-body font-medium text-fg" title={token.name}>
                    {token.name}
                  </span>
                  <Badge tone={token.scopes.includes("followups:write") ? "accent" : "neutral"}>{token.scopes.includes("followups:write") ? t("access.scopeWrite") : t("access.scopeRead")}</Badge>
                </p>
                <p className="text-caption text-fg-muted">
                  {t("access.lastUsed", { date: when(token.last_used_at) })}
                  <span aria-hidden="true"> · </span>
                  {t("settings.tokenExpires", { date: when(token.expires_at) })}
                </p>
              </div>
              {/* Keyed on the revocation count as well, so a row still listed after a revocation (a stale list) starts again from its trigger. */}
              <ConfirmInline key={`${token.id}-${revocations}`} triggerLabel={t("access.revoke")} question={t("access.confirmRevoke")} confirmLabel={t("access.revoke")} cancelLabel={t("followup.cancel")} busy={revoke.isPending && revoke.variables === token.id} onConfirm={() => revoke.mutate(token.id)} />
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p className="text-small text-tone-blocked" role="alert">
          {t("access.revokeError")}
        </p>
      )}
    </SettingsCard>
  );
}

// Three cards rather than three rules inside one: an MCP endpoint, a terminal command and the list of what currently holds a token are separate concerns.
export function AccessSettings() {
  const { t } = useTranslation();
  const origin = serverOrigin();
  const endpoint = origin + "/api/v1/mcp";
  // The shape every MCP client asks for: a named remote server and its URL.
  const clientConfig = JSON.stringify({ mcpServers: { "pr-desk": { url: endpoint } } }, null, 2);
  return (
    <>
      <SettingsCard title={t("access.mcp")} description={t("access.mcpHelp")}>
        <Snippet title={t("access.endpoint")} code={endpoint} hint={t("access.endpointHelp")} copyLabel={t("access.copyEndpoint")} copy={writeClipboard} />
        <Snippet title={t("access.clientConfig")} code={clientConfig} hint={t("access.clientConfigHelp")} copyLabel={t("access.copyConfig")} copy={writeClipboard} />
        <p className="text-small text-fg-muted">{t("access.scopesHelp")}</p>
      </SettingsCard>
      <SettingsCard title={t("access.cli")} description={t("access.cliHelp")}>
        <Snippet title={t("access.cliSignIn")} code={`prdesk login --host ${origin} --write`} hint={t("access.cliSignInHelp")} copyLabel={t("access.copyCommand")} copy={writeClipboard} />
        <Snippet title={t("access.cliCommon")} code={["prdesk followups --state action", "prdesk followups --json | jq '.follow_ups[]'", "prdesk handled <id> <version>"].join("\n")} hint={t("access.cliCommonHelp")} copyLabel={t("access.copyCommand")} copy={writeClipboard} />
      </SettingsCard>
      <IssuedTokens />
    </>
  );
}
