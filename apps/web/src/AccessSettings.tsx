import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";

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
      className="secondary-action access-copy"
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
    <div className="followup-field">
      <span className="access-label" id={id}>
        {title}
      </span>
      <div className="access-snippet" role="group" aria-labelledby={id}>
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
    <div className="followup-settings-group">
      <div className="followup-settings-heading">
        <h2 id="authorized-clients-heading">{t("access.tokens")}</h2>
        <p>{t("access.tokensHelp")}</p>
      </div>
      {tokens.isError ? (
        <p className="followup-settings-warning" role="alert">
          <span>{t("access.tokensError")}</span>
          <button className="secondary-action" type="button" onClick={() => tokens.refetch()}>
            {t("followup.retry")}
          </button>
        </p>
      ) : rows.length === 0 && !tokens.isPending ? (
        <p className="followup-empty-note">{t("access.noTokens")}</p>
      ) : (
        <ul className="access-token-list">
          {rows.map((token: IssuedToken) => (
            <li key={token.id} className="access-token">
              <strong>{token.name}</strong>
              <span className="access-token-scope">{token.scopes.includes("followups:write") ? t("access.scopeWrite") : t("access.scopeRead")}</span>
              <span className="access-token-dates">{t("access.lastUsed", { date: when(token.last_used_at) })}</span>
              {confirming === token.id ? (
                <>
                  <span className="access-token-confirm">{t("access.confirmRevoke")}</span>
                  <button className="secondary-action followup-destination-danger" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>
                    {t("access.revoke")}
                  </button>
                  <button className="secondary-action" type="button" onClick={() => setConfirming(0)}>
                    {t("followup.cancel")}
                  </button>
                </>
              ) : (
                <button className="secondary-action followup-destination-danger" type="button" onClick={() => setConfirming(token.id)}>
                  {t("access.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p className="followup-field-error" role="alert">
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
      <section className="followup-settings" aria-labelledby="programmatic-access-heading">
        <div className="followup-settings-group">
          <div className="followup-settings-heading">
            <h2 id="programmatic-access-heading">{t("access.mcp")}</h2>
            <p>{t("access.mcpHelp")}</p>
          </div>
          <Snippet title={t("access.endpoint")} value={endpoint} hint={t("access.endpointHelp")} copyLabel={t("access.copyEndpoint")} />
          <Snippet title={t("access.clientConfig")} value={clientConfig} hint={t("access.clientConfigHelp")} copyLabel={t("access.copyConfig")} />
          <p className="followup-settings-note">{t("access.scopesHelp")}</p>
        </div>
      </section>

      <section className="followup-settings" aria-labelledby="command-line-access-heading">
        <div className="followup-settings-group">
          <div className="followup-settings-heading">
            <h2 id="command-line-access-heading">{t("access.cli")}</h2>
            <p>{t("access.cliHelp")}</p>
          </div>
          <Snippet title={t("access.cliSignIn")} value={`prdesk login --host ${origin} --write`} hint={t("access.cliSignInHelp")} copyLabel={t("access.copyCommand")} />
          <Snippet title={t("access.cliCommon")} value={["prdesk followups --state action", "prdesk followups --json | jq '.follow_ups[]'", "prdesk handled <id> <version>"].join("\n")} hint={t("access.cliCommonHelp")} copyLabel={t("access.copyCommand")} />
        </div>
      </section>

      <section className="followup-settings" aria-labelledby="authorized-clients-heading">
        <IssuedTokens />
      </section>
    </>
  );
}
