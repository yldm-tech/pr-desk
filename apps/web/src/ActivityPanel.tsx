import { CircleCheck, CircleDashed, CircleX, Clock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Activity } from "./activity-model";
import { activityWarningKeys, checkTone, safeGitHubLink } from "./activity-model";
import { cx } from "./ui-controls";
import { Avatar, formatDateTime, Notice } from "./ui-display";

type CheckTone = ReturnType<typeof checkTone>;

// The colour and shape of a check result. The tone words are activity-model's (checkTone); the classes are the tone tokens, so a failing build reads in the same red as a blocked row and never by colour alone.
const checkStyle: Record<CheckTone, { text: string; icon: LucideIcon }> = { failure: { text: "text-tone-blocked", icon: CircleX }, pending: { text: "text-tone-waiting", icon: Clock }, success: { text: "text-tone-ready", icon: CircleCheck }, unknown: { text: "text-fg-muted", icon: CircleDashed } };
// Failing first, then still running, then the rest: the check the reader has to act on is the one at the top.
const checkOrder: Record<CheckTone, number> = { failure: 0, pending: 1, success: 2, unknown: 3 };

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="flex items-baseline gap-1.5 text-small font-semibold text-fg">
        {title}
        {count !== undefined && <span className="font-medium text-fg-subtle tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-md bg-bg-subtle px-3 py-2.5 text-caption text-fg-muted">{children}</p>;

const location = (path?: string, line?: number | null) =>
  path ? (
    <code className="min-w-0 justify-self-start rounded-sm bg-bg-muted px-1 py-px font-mono text-caption text-fg-muted [overflow-wrap:anywhere]">
      {path}
      {line ? `:${line}` : ""}
    </code>
  ) : null;

// What GitHub says about one pull request: the checks, the review threads and the conversation, in the order a reader deciding what to do next needs them. A partial response says which part is missing above everything else; each section keeps its own "unavailable" and "empty" wording, because a list GitHub did not return and a list that is empty are different facts.
export function ActivityPanel({ data }: { data: Activity }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const date = (value: string) => (Number.isNaN(Date.parse(value)) ? t("unknown") : formatDateTime(new Date(value), language));
  const comments = [...(data.conversation ?? []).map((comment) => ({ ...comment, kind: "conversation" })), ...(data.review_comments ?? []).map((comment) => ({ ...comment, kind: "review" }))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const checks = data.checks && [...data.checks].sort((a, b) => checkOrder[checkTone(a.status, a.conclusion)] - checkOrder[checkTone(b.status, b.conclusion)]);
  const checkLabel = (status: string, conclusion: string) => (status === "completed" ? t((conclusion || "unknown").toLowerCase(), { defaultValue: conclusion ? conclusion.replaceAll("_", " ") : t("unknown") }) : t(status.replaceAll("_", ""), { defaultValue: status.replaceAll("_", " ") }));
  return (
    <div className="grid min-w-0 gap-6">
      {data.warnings.length > 0 && (
        <Notice tone="warning" role="status" title={t("activityLoadFailed")}>
          <ul className="m-0 grid list-disc gap-0.5 pl-5">
            {data.warnings.map((warning, index) => {
              const { sectionKey, reasonKey, section, reason } = activityWarningKeys(warning);
              return (
                <li key={index}>
                  {section ? `${sectionKey ? t(sectionKey) : section}: ` : ""}
                  {reasonKey ? t(reasonKey) : reason}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-caption text-fg-muted">{t("availableResults")}</p>
        </Notice>
      )}
      <Section title={t("ciChecks")} count={checks?.length}>
        {checks === null ? (
          <Empty>{t("checksUnavailable")}</Empty>
        ) : checks.length === 0 ? (
          <Empty>{t("noChecks")}</Empty>
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0">
            {checks.map((check) => {
              const style = checkStyle[checkTone(check.status, check.conclusion)];
              const Icon = style.icon;
              const link = safeGitHubLink(check.html_url);
              return (
                <li key={check.id} className="flex min-h-8 min-w-0 items-center gap-2 border-b border-line py-1 text-body last:border-b-0">
                  <Icon size={14} aria-hidden="true" className={cx("shrink-0", style.text)} />
                  <span className="min-w-0 flex-1 truncate">
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="text-fg no-underline hover:underline">
                        {check.name}
                      </a>
                    ) : (
                      check.name
                    )}
                  </span>
                  <span className={cx("shrink-0 text-caption font-medium", style.text)}>{checkLabel(check.status, check.conclusion)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title={t("reviewDiscussions")} count={data.threads?.length}>
        {data.threads === null ? (
          <Empty>{t("discussionUnavailable")}</Empty>
        ) : data.threads.length === 0 ? (
          <Empty>{t("noDiscussions")}</Empty>
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0">
            {data.threads.map((thread) => (
              <li key={thread.id} className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-1 text-body last:border-b-0">
                <span className={cx("inline-flex shrink-0 items-center gap-1 text-caption font-medium", thread.isResolved ? "text-tone-ready" : "text-tone-action")}>
                  {thread.isResolved ? <CircleCheck size={13} aria-hidden="true" /> : <Clock size={13} aria-hidden="true" />}
                  {thread.isResolved ? t("resolved") : t("unresolved")}
                </span>
                {location(thread.path, thread.line)}
                {thread.isOutdated && <span className="text-caption text-fg-subtle">{t("outdated")}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("comments")} count={comments.length}>
        {comments.length === 0 ? (
          <Empty>{data.warnings.length ? t("noCommentsAvailable") : t("noComments")}</Empty>
        ) : (
          <ol className="m-0 grid list-none gap-4 p-0">
            {comments.map((comment) => {
              const link = safeGitHubLink(comment.html_url);
              return (
                <li key={`${comment.kind}-${comment.id}`} className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-x-2.5">
                  <span className="pt-px">
                    <Avatar login={comment.user?.login ?? ""} size={20} />
                  </span>
                  <div className="grid min-w-0 gap-1">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-caption text-fg-muted">
                      <strong className="text-small font-semibold text-fg">
                        {comment.user?.login ? (
                          <a href={`https://github.com/${encodeURIComponent(comment.user.login)}`} target="_blank" rel="noreferrer" className="text-fg no-underline hover:underline">
                            {comment.user.login}
                          </a>
                        ) : (
                          t("deletedUser")
                        )}
                      </strong>
                      <span>
                        {t(comment.kind)} · {date(comment.created_at)}
                      </span>
                    </p>
                    {location(comment.path, comment.line)}
                    <p className="text-body whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{comment.body}</p>
                    {link && (
                      <a href={link} target="_blank" rel="noreferrer" className="justify-self-start text-caption text-accent-text no-underline hover:underline">
                        {t("viewGitHub")}
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}
