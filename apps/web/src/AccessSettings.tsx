import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { compactAction, copyAction, dangerAction, secondaryAction } from "./action-styles";
import { row, rowConfirm, rowList, rowTag, settingsCard, settingsEmptyNote, settingsField, settingsFieldError, settingsGroup, settingsHeading, settingsNote, settingsWarning } from "./settings-styles";

// The endpoint an agent connects to is this deployment's own origin. apiURL is
// empty in production because the Go server serves the app, so the browser's
// location is the authoritative answer for both.
const serverOrigin = () => (apiURL || window.location.origin).replace(/\/$/, "");

const tokenSchema = z.object({ data: z.array(z.object({ id: z.number(), name: z.string(), client_id: z.string(), scopes: z.array(z.string()), created_at: z.string(), expires_at: z.string(), last_used_at: z.string().nullable() })) });
type IssuedToken = z.infer<typeof tokenSchema>["data"][number];

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={copyAction}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {t(copied ? "access.copied" : "access.copy")}
    </button>
  );
}

function Snippet({ title, value, hint, copyLabel }: { title: string; value: string; hint: string; copyLabel: string }) {
  const id = useId();
  return (
    <div className={settingsField}>
      <span className="text-[12px] font-medium" id={id}>
        {title}
      </span>
      <div
        className="flex min-w-0 items-start gap-2 [@media(max-width:640px)]:flex-col [@media(max-width:640px)]:[&_pre]:w-full [&_code]:font-[family-name:ui-monospace,SFMono-Regular,Menlo,monospace] [&_code]:text-[12px] [&_code]:leading-[1.7] [&_code]:whitespace-pre [&_pre]:m-0 [&_pre]:min-w-0 [&_pre]:flex-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[var(--border)] [&_pre]:bg-[var(--surface-muted)] [&_pre]:px-3 [&_pre]:py-2.5"
        role="group"
        aria-labelledby={id}
      >
        <pre>
          <code>{value}</code>
        </pre>
        <CopyButton value={value} label={copyLabel} />
      </div>
      <small>{hint}</small>
    </div>
  );
}

function IssuedTokens() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(0);
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
      setConfirming(0);
      void client.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });
  const when = (value: string | null) => (value ? new Date(value).toLocaleDateString(i18n.resolvedLanguage) : t("access.never"));
  const rows = tokens.data?.data || [];
  return (
    <div className={settingsGroup}>
      <div className={settingsHeading}>
        <h2 id="authorized-clients-heading">{t("access.tokens")}</h2>
        <p>{t("access.tokensHelp")}</p>
      </div>
      {tokens.isError ? (
        <p className={settingsWarning} role="alert">
          <span>{t("access.tokensError")}</span>
          <button className={secondaryAction} type="button" onClick={() => tokens.refetch()}>
            {t("followup.retry")}
          </button>
        </p>
      ) : rows.length === 0 && !tokens.isPending ? (
        <p className={settingsEmptyNote}>{t("access.noTokens")}</p>
      ) : (
        <ul className={rowList}>
          {rows.map((token: IssuedToken) => (
            <li key={token.id} className={row} data-testid="issued-token">
              <strong>{token.name}</strong>
              <span className={rowTag}>{token.scopes.includes("followups:write") ? t("access.scopeWrite") : t("access.scopeRead")}</span>
              <span className="text-[12px] whitespace-nowrap text-[var(--muted)] [@media(max-width:640px)]:basis-full">{t("access.lastUsed", { date: when(token.last_used_at) })}</span>
              {confirming === token.id ? (
                <>
                  <span className={rowConfirm}>{t("access.confirmRevoke")}</span>
                  <button className={dangerAction} type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>
                    {t("access.revoke")}
                  </button>
                  <button className={compactAction} type="button" onClick={() => setConfirming(0)}>
                    {t("followup.cancel")}
                  </button>
                </>
              ) : (
                <button className={dangerAction} type="button" onClick={() => setConfirming(token.id)}>
                  {t("access.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p className={settingsFieldError} role="alert">
          {t("access.revokeError")}
        </p>
      )}
    </div>
  );
}

export function AccessSettings() {
  const { t } = useTranslation();
  const origin = serverOrigin();
  const endpoint = origin + "/api/v1/mcp";
  // The shape every MCP client asks for: a named remote server and its URL.
  const clientConfig = JSON.stringify({ mcpServers: { "pr-desk": { url: endpoint } } }, null, 2);
  // Three cards rather than three rules inside one: an MCP endpoint, a terminal
  // command and the list of what currently holds a token are separate concerns,
  // and as one card they outweighed every other section on the page.
  return (
    <>
      <section className={settingsCard} aria-labelledby="programmatic-access-heading">
        <div className={settingsGroup}>
          <div className={settingsHeading}>
            <h2 id="programmatic-access-heading">{t("access.mcp")}</h2>
            <p>{t("access.mcpHelp")}</p>
          </div>
          <Snippet title={t("access.endpoint")} value={endpoint} hint={t("access.endpointHelp")} copyLabel={t("access.copyEndpoint")} />
          <Snippet title={t("access.clientConfig")} value={clientConfig} hint={t("access.clientConfigHelp")} copyLabel={t("access.copyConfig")} />
          <p className={settingsNote}>{t("access.scopesHelp")}</p>
        </div>
      </section>

      <section className={settingsCard} aria-labelledby="command-line-access-heading">
        <div className={settingsGroup}>
          <div className={settingsHeading}>
            <h2 id="command-line-access-heading">{t("access.cli")}</h2>
            <p>{t("access.cliHelp")}</p>
          </div>
          <Snippet title={t("access.cliSignIn")} value={`prdesk login --host ${origin} --write`} hint={t("access.cliSignInHelp")} copyLabel={t("access.copyCommand")} />
          <Snippet title={t("access.cliCommon")} value={["prdesk followups --state action", "prdesk followups --json | jq '.follow_ups[]'", "prdesk handled <id> <version>"].join("\n")} hint={t("access.cliCommonHelp")} copyLabel={t("access.copyCommand")} />
        </div>
      </section>

      <section className={settingsCard} aria-labelledby="authorized-clients-heading">
        <IssuedTokens />
      </section>
    </>
  );
}
