import { useTranslation } from "react-i18next";
import type { Activity } from "./activity-model";
import { activityWarningKeys, checkTone, checkToneClass, safeGitHubLink } from "./activity-model";
import { activityComment, activitySection, activityThread } from "./activity-styles";

export function ActivityPanel({ data }: { data: Activity }) {
  const { t: tr, i18n } = useTranslation();
  const date = (value: string) => (Number.isNaN(Date.parse(value)) ? tr("unknown") : new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)));
  const comments = [...(data.conversation ?? []).map((c) => ({ ...c, kind: "conversation" })), ...(data.review_comments ?? []).map((c) => ({ ...c, kind: "review" }))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <>
      {data.warnings.length > 0 && (
        <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-[13px] text-[var(--warning)] [&_ul]:pl-5" role="status">
          <strong>{tr("activityLoadFailed")}</strong>
          <ul>
            {data.warnings.map((w, i) => {
              const { sectionKey, reasonKey, section, reason } = activityWarningKeys(w);
              return (
                <li key={i}>
                  {section ? `${sectionKey ? tr(sectionKey) : section}: ` : ""}
                  {reasonKey ? tr(reasonKey) : reason}
                </li>
              );
            })}
          </ul>
          <p>{tr("availableResults")}</p>
        </div>
      )}
      <section className={activitySection}>
        <h3>
          {tr("comments")}
          <span className="rounded-[5px] bg-[var(--surface-muted)] px-1.5 py-px text-[11px] font-medium text-[var(--muted)]">{comments.length}</span>
        </h3>
        {comments.length === 0 && <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-[12px] text-[var(--muted)]">{data.warnings.length ? tr("noCommentsAvailable") : tr("noComments")}</p>}
        {comments.map((c) => (
          <article key={`${c.kind}-${c.id}`} className={activityComment}>
            <strong>
              {c.user?.login ? (
                <a className="font-semibold text-[var(--foreground)] no-underline" href={`https://github.com/${encodeURIComponent(c.user.login)}`} target="_blank" rel="noreferrer">
                  {c.user.login}
                </a>
              ) : (
                tr("deletedUser")
              )}
            </strong>
            <small>
              {tr(c.kind)} · {date(c.created_at)}
            </small>
            {c.path && (
              <code>
                {c.path}
                {c.line ? `:${c.line}` : ""}
              </code>
            )}
            <p>{c.body}</p>
            {safeGitHubLink(c.html_url) && (
              <a href={safeGitHubLink(c.html_url)} target="_blank" rel="noreferrer">
                {tr("viewGitHub")}
              </a>
            )}
          </article>
        ))}
      </section>
      <section className={activitySection}>
        <h3>
          {tr("reviewDiscussions")}
          {data.threads && <span className="rounded-[5px] bg-[var(--surface-muted)] px-1.5 py-px text-[11px] font-medium text-[var(--muted)]">{data.threads.length}</span>}
        </h3>
        {data.threads === null ? (
          <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-[12px] text-[var(--muted)]">{tr("discussionUnavailable")}</p>
        ) : data.threads.length === 0 ? (
          <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-[12px] text-[var(--muted)]">{tr("noDiscussions")}</p>
        ) : (
          data.threads.map((t) => (
            <div className={activityThread} key={t.id}>
              <span className={t.isResolved ? "text-[var(--success)]" : "text-[var(--danger)]"}>{t.isResolved ? tr("resolved") : tr("unresolved")}</span>
              <span>
                {t.path}
                {t.line ? `:${t.line}` : ""}
                {t.isOutdated ? ` · ${tr("outdated")}` : ""}
              </span>
            </div>
          ))
        )}
      </section>
      <section className={activitySection}>
        <h3>
          {tr("ciChecks")}
          {data.checks && <span className="rounded-[5px] bg-[var(--surface-muted)] px-1.5 py-px text-[11px] font-medium text-[var(--muted)]">{data.checks.length}</span>}
        </h3>
        {data.checks === null ? (
          <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-[12px] text-[var(--muted)]">{tr("checksUnavailable")}</p>
        ) : data.checks.length === 0 ? (
          <p className="rounded-lg bg-[var(--surface-muted)] p-4 text-[12px] text-[var(--muted)]">{tr("noChecks")}</p>
        ) : (
          data.checks.map((c) => (
            <div className={activityThread} key={c.id}>
              <span>
                {safeGitHubLink(c.html_url) ? (
                  <a href={safeGitHubLink(c.html_url)} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </span>
              <span className={`ml-2 inline-flex items-center text-[11px] capitalize ${checkToneClass(checkTone(c.status, c.conclusion))}`}>
                {c.status === "completed" ? tr((c.conclusion || "unknown").toLowerCase(), { defaultValue: c.conclusion ? c.conclusion.replaceAll("_", " ") : tr("unknown") }) : tr(c.status.replaceAll("_", ""), { defaultValue: c.status.replaceAll("_", " ") })}
              </span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
