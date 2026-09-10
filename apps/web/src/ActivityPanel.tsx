import { useTranslation } from "react-i18next";
import type { Activity } from "./activity-model";
import { checkTone, safeGitHubLink } from "./activity-model";

export function ActivityPanel({ data }: { data: Activity }) {
  const { t: tr, i18n } = useTranslation();
  const date = (value: string) => (Number.isNaN(Date.parse(value)) ? tr("unknown") : new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)));
  const comments = [...(data.conversation ?? []).map((c) => ({ ...c, kind: "conversation" })), ...(data.review_comments ?? []).map((c) => ({ ...c, kind: "review" }))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <>
      {data.warnings.length > 0 && (
        <div className="activity-warning" role="status">
          <strong>{tr("activityLoadFailed")}</strong>
          <ul>
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <p>{tr("availableResults")}</p>
        </div>
      )}
      <section className="activity-section">
        <h3>
          {tr("comments")}
          <span className="activity-count">{comments.length}</span>
        </h3>
        {comments.length === 0 && <p className="muted">{data.warnings.length ? tr("noCommentsAvailable") : tr("noComments")}</p>}
        {comments.map((c) => (
          <article key={`${c.kind}-${c.id}`} className="comment">
            <strong>
              {c.user?.login ? (
                <a className="comment-author" href={`https://github.com/${encodeURIComponent(c.user.login)}`} target="_blank" rel="noreferrer">
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
      <section className="activity-section">
        <h3>
          {tr("reviewDiscussions")}
          {data.threads && <span className="activity-count">{data.threads.length}</span>}
        </h3>
        {data.threads === null ? (
          <p className="muted">{tr("discussionUnavailable")}</p>
        ) : data.threads.length === 0 ? (
          <p className="muted">{tr("noDiscussions")}</p>
        ) : (
          data.threads.map((t) => (
            <div className="thread" key={t.id}>
              <span className={t.isResolved ? "resolved" : "unresolved"}>{t.isResolved ? tr("resolved") : tr("unresolved")}</span>
              <span>
                {t.path}
                {t.line ? `:${t.line}` : ""}
                {t.isOutdated ? ` · ${tr("outdated")}` : ""}
              </span>
            </div>
          ))
        )}
      </section>
      <section className="activity-section">
        <h3>
          {tr("ciChecks")}
          {data.checks && <span className="activity-count">{data.checks.length}</span>}
        </h3>
        {data.checks === null ? (
          <p className="muted">{tr("checksUnavailable")}</p>
        ) : data.checks.length === 0 ? (
          <p className="muted">{tr("noChecks")}</p>
        ) : (
          data.checks.map((c) => (
            <div className="thread" key={c.id}>
              <span>
                {safeGitHubLink(c.html_url) ? (
                  <a href={safeGitHubLink(c.html_url)} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </span>
              <span className={`checks ${checkTone(c.status, c.conclusion)}`}>{c.status === "completed" ? tr((c.conclusion || "unknown").toLowerCase(), { defaultValue: c.conclusion || tr("unknown") }) : tr(c.status.replaceAll("_", ""), { defaultValue: c.status.replaceAll("_", " ") })}</span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
