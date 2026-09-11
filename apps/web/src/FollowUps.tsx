import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { PRSchema } from "./pr-model";
import { safeGitHubLink } from "./activity-model";

// Reasons are grouped by what the reader has to do about them: a blocked PR
// needs a fix, an action is waiting on the reader, and the timing reasons only
// say that the clock ran out.
const reasonTones: Record<string, string> = { conflict: "blocked", checks_failed: "blocked", review_requested: "action", human_feedback: "action", approval_revoked: "action", overdue: "waiting", snooze_due: "waiting" };
const reasonTone = (reason: string) => reasonTones[reason] || "neutral";

const followUpSchema = z.object({ id: z.number(), version: z.number(), role: z.string(), state: z.string(), reasons: z.array(z.string()), unread: z.boolean(), excerpt: z.string(), waiting_since: z.string(), archived_at: z.string().nullable(), pr: PRSchema });
const responseSchema = z.object({ data: z.array(followUpSchema), counts: z.record(z.string(), z.number()), baseline_complete: z.boolean() });
type FollowUp = z.infer<typeof followUpSchema>;
export function useFollowUps(enabled = true) {
  return useQuery({
    queryKey: ["follow-ups"],
    enabled,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/follow-ups", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => responseSchema.parse(data)),
    staleTime: 15000,
    refetchInterval: 60000,
  });
}

function FollowUpCard({ item, onChanged }: { item: FollowUp; onChanged: (message: string) => void }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [date, setDate] = useState("");
  const mutation = useMutation({
    mutationFn: (action: { action: string; until?: string }) => ky.post(apiURL + `/api/v1/follow-ups/${item.id}`, { credentials: "include", retry: 0, json: { ...action, version: item.version } }),
    onSuccess: (_result, action) => onChanged(t("followup.announceAction", { action: t(`followup.${action.action === "snooze" ? "snooze" : action.action === "read" ? "read" : "followedUp"}`), title: item.pr.title })),
    onSettled: () => client.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
  const snooze = (days: number) => mutation.mutate({ action: "snooze", until: new Date(Date.now() + days * 86400000).toISOString() });
  const githubURL = safeGitHubLink(item.pr.url || "");
  return (
    <article className="followup-card" id={`followup-${item.id}`}>
      <div className="followup-card-heading">
        <span>
          {item.pr.repo} #{item.pr.number}
        </span>
        <span>
          {t(`followup.${item.role}`)} · {t(`followup.${item.state}`)}
          {item.unread && <> · {t("followup.unread")}</>}
        </span>
      </div>
      <h3>
        <a href={githubURL || undefined} target="_blank" rel="noopener noreferrer" onClick={() => mutation.mutate({ action: "read" })}>
          {item.pr.title}
        </a>
      </h3>
      <div className="followup-reasons">
        {item.reasons.map((reason) => (
          <span key={reason} className="followup-reason" data-tone={reasonTone(reason)}>
            {t(`followup.${reason}`)}
          </span>
        ))}
      </div>
      {item.excerpt && <p className="followup-excerpt">{item.excerpt}</p>}
      <p className="followup-wait">{t("followup.waitingSince", { date: new Date(item.waiting_since).toLocaleString(i18n.resolvedLanguage) })}</p>
      {mutation.isError && <p role="alert">{t("followup.saveError")}</p>}
      <div className="followup-actions">
        {item.unread && (
          <button className="secondary-action" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "read" })}>
            {t("followup.read")}
          </button>
        )}
        {item.state !== "archived" && (
          <>
            <button className="secondary-action" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "handled" })}>
              {t("followup.handled")}
            </button>
            <button className="secondary-action" disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "followed_up" })}>
              {t("followup.followedUp")}
            </button>
            <details>
              <summary>{t("followup.snooze")}</summary>
              <div className="followup-snooze">
                {[3, 7].map((days) => (
                  <button key={days} className="secondary-action" disabled={mutation.isPending} onClick={() => snooze(days)}>
                    {t("followup.days", { count: days })}
                  </button>
                ))}
                <label>
                  {t("followup.custom")}
                  <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <button className="secondary-action" disabled={!date || mutation.isPending || !Number.isFinite(new Date(date).getTime()) || new Date(date).getTime() <= Date.now()} onClick={() => mutation.mutate({ action: "snooze", until: new Date(date).toISOString() })}>
                  {t("followup.confirmSnooze")}
                </button>
              </div>
            </details>
          </>
        )}
      </div>
    </article>
  );
}

export function FollowUpSummary() {
  const { t } = useTranslation();
  const query = useFollowUps();
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  if (query.isError)
    return (
      <p role="alert">
        {t("followup.unavailable")} <button onClick={() => query.refetch()}>{t("followup.retry")}</button>
      </p>
    );
  const priority = query.data.data.filter((item) => item.state === "action" || item.state === "follow_up").slice(0, 5);
  return (
    <section className="followup-summary" aria-label={t("followup.title")}>
      {!query.data.baseline_complete && <p role="status">{t("followup.baseline")}</p>}
      <div className="followup-counts">
        {["authored", "reviewer", "follow_up", "recent_merged"].map((key) => (
          <Link key={key} to={`/attention?${key === "authored" || key === "reviewer" ? `role=${key}&status=action` : `status=${key === "recent_merged" ? "archived&merged=1" : key}`}`}>
            <span>{t(`followup.${key === "authored" || key === "reviewer" ? key + "_action" : key}`)}</span>
            <strong>{query.data.counts[key] || 0}</strong>
          </Link>
        ))}
      </div>
      <div className="panel-heading">
        <h2>{t("followup.priority")}</h2>
        <Link to="/attention">{t("followup.viewAll")}</Link>
      </div>
      <ul className="followup-priority">
        {priority.map((item) => (
          <li key={item.id}>
            <Link to={`/attention?focus=${item.id}`}>
              <span>
                {item.pr.repo} #{item.pr.number} · {item.pr.title}
              </span>
              <small className="followup-priority-reasons">
                {item.reasons.map((reason) => (
                  <span key={reason} className="followup-reason" data-tone={reasonTone(reason)}>
                    {t(`followup.${reason}`)}
                  </span>
                ))}
              </small>
            </Link>
          </li>
        ))}
      </ul>
      {priority.length === 0 && <p>{t("followup.empty")}</p>}
    </section>
  );
}

export function FollowUpWorkspace() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // An action can remove the card that held the focus, and nothing announced
  // the result, so a screen reader user was left with no feedback and the focus
  // on the document body. The counter makes repeating the same action announce
  // again; the check runs after the render that removed the card, because
  // before it the focus is still on a button that is about to disappear.
  const [announcement, setAnnouncement] = useState({ text: "", id: 0 });
  const region = useRef<HTMLElement>(null);
  const announce = (text: string) => setAnnouncement((previous) => ({ text, id: previous.id + 1 }));
  const query = useFollowUps();
  const role = params.get("role") || "all",
    status = params.get("status") || "all",
    repo = params.get("repo") || "";
  const change = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      next.delete("focus");
      next.delete("merged");
      return next;
    });
  const clearRepository = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("repo");
      return next;
    });
  const items = (query.data?.data || []).filter(
    (item) =>
      (!params.get("focus") || String(item.id) === params.get("focus")) &&
      (role === "all" || item.role === role) &&
      (!repo || item.pr.repo === repo) &&
      (status === "all" ? item.state !== "archived" : item.state === status) &&
      (!params.get("merged") || (item.pr.merged_at && item.archived_at && new Date(item.archived_at).getTime() > Date.now() - 7 * 86400000)),
  );
  useEffect(() => {
    if (announcement.id && document.activeElement === document.body) region.current?.focus();
  }, [announcement, items.length]);
  return (
    <section className="followup-workspace" ref={region} tabIndex={-1}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.text}
      </p>
      {query.data && !query.data.baseline_complete && <p role="status">{t("followup.baseline")}</p>}
      <div className="panel-heading">
        <h2>{t("followup.title")}</h2>
        <Link to="/settings">{t("followup.goSettings")}</Link>
      </div>
      {repo && (
        <p className="search-chip followup-repository-chip">
          <span>{repo}</span>
          <button className="linkbtn" type="button" onClick={clearRepository} aria-label={t("clearRepositoryFilter", { repo })}>
            ×
          </button>
        </p>
      )}
      <div className="followup-filters">
        <div role="group" aria-label={t("followup.title")}>
          {["all", "authored", "reviewer"].map((value) => (
            <button key={value} className="secondary-action" aria-pressed={role === value} onClick={() => change("role", value)}>
              {t(`followup.${value}`)}
            </button>
          ))}
        </div>
        <select aria-label={t("status")} value={status} onChange={(e) => change("status", e.target.value)}>
          {["all", "action", "waiting", "follow_up", "draft", "archived"].map((value) => (
            <option key={value} value={value}>
              {t(`followup.${value}`)}
            </option>
          ))}
        </select>
      </div>
      {status === "draft" && <p>{t("followup.draftHelp")}</p>}
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : query.isError ? (
        <p role="alert">
          {t("followup.unavailable")} <button onClick={() => query.refetch()}>{t("followup.retry")}</button>
        </p>
      ) : items.length ? (
        items.map((item) => <FollowUpCard key={item.id} item={item} onChanged={announce} />)
      ) : (
        <p>{t("followup.empty")}</p>
      )}
    </section>
  );
}
