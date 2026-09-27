import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import { BellRing, Check, Plus } from "lucide-react";
import ky, { HTTPError } from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { AccessSettings, SettingsCard } from "./AccessSettings";
import { GitHubAccessPanel } from "./GitHubAccessPanel";
import { FormSkeleton } from "./LoadingSkeleton";
import { OverridesEditor, overridesDays, rowsFromDays, type OverrideProblems, type OverridesValue } from "./OverridesEditor";
import { useRepositories } from "./queries";
import { Button, Checkbox, cx, Field, Tabs, TextField } from "./ui-controls";
import { Badge, EmptyState, ErrorState, FactChip, Notice, PageHeader, StaleNotice } from "./ui-display";
import { ConfirmInline } from "./ui-overlay";

export { parseOverrides } from "./OverridesEditor";

const settingsSchema = z.object({ timezone: z.string(), digest_time: z.string(), wait_days: z.number(), language: z.enum(["en", "zh-CN"]).default("en"), teams: z.array(z.string()).nullable(), repository_days: z.record(z.string(), z.number()).nullable() });
type Settings = z.infer<typeof settingsSchema>;
const channels = ["telegram", "lark", "email", "webhook"] as const;
type Channel = (typeof channels)[number];
type Destination = { id: number; name: string; kind: Channel; enabled: boolean; failing?: boolean };
const emptyDraft = { kind: "telegram" as Channel, name: "", token: "", chat_id: "", url: "", secret: "", host: "", port: "587", username: "", password: "", from: "", to: "" };
type Draft = typeof emptyDraft;
const channelLabel = (kind: string) => `followup.channel${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
// Mirrors destinationNameLimit and destinationRecipientLimit on the server.
const nameLimit = 100;
const recipientLimit = 20;
// The server parses addresses with net/mail, which accepts a display name. The browser check stays deliberately narrower than RFC 5322 but has to allow the same two spellings so the form does not reject what the server stores.
const emailPattern = /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;
const recipientList = (value: string) =>
  value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

// The server refuses to dial private addresses, so the same families are reported in the form instead of after a failed delivery attempt.
function isPrivateHost(value: string) {
  let host = value.trim().toLowerCase();
  try {
    host = new URL(host).hostname;
  } catch {
    /* A bare host name is checked as typed. */
  }
  host = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [first, second] = parts.map(Number);
  return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

// allowPrivate mirrors NOTIFY_ALLOW_PRIVATE_HOSTS on the server: with it the server also accepts plain http, because internal endpoints rarely have a certificate, and the form has to accept the same addresses it does.
export function draftErrors(draft: Draft, allowPrivate: boolean): Record<string, string> {
  const found: Record<string, string> = {};
  if (!draft.name.trim()) found.name = "followup.required";
  else if (Array.from(draft.name.trim()).length > nameLimit) found.name = "followup.nameTooLong";
  if (draft.kind === "telegram") {
    if (!draft.token.trim()) found.token = "followup.required";
    if (!/^-?\d+$/.test(draft.chat_id.trim())) found.chat_id = "followup.chatIdInvalid";
  }
  if (draft.kind === "lark" || draft.kind === "webhook") {
    const url = draft.url.trim();
    if (!(allowPrivate ? /^https?:\/\/\S+$/i : /^https:\/\/\S+$/i).test(url)) found.url = "followup.invalidUrl";
    else if (!allowPrivate && isPrivateHost(url)) found.url = "followup.privateUrl";
  }
  if (draft.kind === "email") {
    // Mirrors validateDestinationHost: a pasted "smtp.example.com:587" is refused by the server, which the form has no other way to explain.
    const host = draft.host.trim();
    if (!host) found.host = "followup.required";
    else if (/[ /:]/.test(host)) found.host = "followup.invalidHost";
    else if (!allowPrivate && isPrivateHost(host)) found.host = "followup.privateUrl";
    const port = Number(draft.port.trim());
    if (draft.port.trim() && !(Number.isInteger(port) && port >= 1 && port <= 65535)) found.port = "followup.invalidPort";
    if (!emailPattern.test(draft.from.trim())) found.from = "followup.invalidEmail";
    const recipients = recipientList(draft.to);
    if (!recipients.length || recipients.some((entry) => !emailPattern.test(entry))) found.to = "followup.invalidEmail";
    else if (recipients.length > recipientLimit) found.to = "followup.tooManyRecipients";
  }
  return found;
}

// A rejected destination comes back with the reason it was refused, which names the offending field; anything else keeps the generic copy, because a status line from a proxy is not something to show an operator as an explanation.
export function addErrorMessage(error: unknown): string {
  if (!(error instanceof HTTPError) || error.response.status !== 400) return "";
  const body = z.object({ error: z.string().optional() }).safeParse(error.data);
  return (body.success && body.data.error) || "";
}

function destinationPayload(draft: Draft) {
  const base = { kind: draft.kind, name: draft.name.trim() };
  if (draft.kind === "telegram") return { ...base, token: draft.token.trim(), chat_id: Number(draft.chat_id.trim()) };
  if (draft.kind === "email") return { ...base, host: draft.host.trim(), port: Number(draft.port.trim()) || 587, username: draft.username.trim(), password: draft.password, from: draft.from.trim(), to: recipientList(draft.to) };
  return { ...base, url: draft.url.trim(), secret: draft.secret.trim() };
}

// The zone list keeps the free-text IANA field autocompletable; older engines simply get no suggestions.
const supportedTimezones = (): string[] => {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    return supported ? supported("timeZone") : [];
  } catch {
    return [];
  }
};
const isTimezone = (zone: string) => {
  if (!zone || zone === "Local") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// The look of the Select primitive for a select that Field labels: Select brings its own label, and a second one would read the name twice.
const selectClass =
  "min-h-8 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-line-strong bg-surface bg-[image:var(--icon-chevron)] bg-[length:14px] bg-[position:right_0.5rem_center] bg-no-repeat py-1 pr-8 pl-2.5 text-body text-fg transition-colors duration-[var(--dur-fast)] hover:border-fg-subtle aria-invalid:border-tone-blocked disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:text-[length:1rem]";

function SettingsForm({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [time, setTime] = useState(settings.digest_time);
  const [days, setDays] = useState(settings.wait_days);
  const [language, setLanguage] = useState(settings.language);
  const [selected, setSelected] = useState(settings.teams || []);
  const [saved] = useState(() => settings.teams || []);
  const [overrides, setOverrides] = useState<OverridesValue>(() => ({ mode: "rows", rows: rowsFromDays(settings.repository_days), text: "" }));
  const [overrideProblems, setOverrideProblems] = useState<OverrideProblems>({});
  const [timezoneInvalid, setTimezoneInvalid] = useState(false);
  const [focusInvalid, setFocusInvalid] = useState(0);
  // Whether anything has been edited since the settings were loaded or last saved. The save bar is only on screen while there is something to save, or while a save is being reported.
  const [dirty, setDirty] = useState(false);
  const zones = useMemo(supportedTimezones, []);
  const repositories = useRepositories(true);
  const suggestions = useMemo(() => (repositories.data || []).map((entry) => entry.repo), [repositories.data]);
  const teams = useQuery({
    queryKey: ["review-teams"],
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/review-teams", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => z.object({ data: z.array(z.object({ id: z.string(), name: z.string() })) }).parse(data)),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (repository_days: Record<string, number>) => ky.post(apiURL + "/api/v1/follow-up-settings", { credentials: "include", retry: 0, json: { timezone: timezone.trim(), digest_time: time, wait_days: days, language, teams: selected, repository_days } }),
    onSuccess: () => {
      setDirty(false);
      void client.invalidateQueries({ queryKey: ["follow-up-settings"] });
      void client.invalidateQueries({ queryKey: ["follow-ups"] });
    },
  });
  // A save the form refused moves the focus to the first field it named, so a keyboard or screen-reader user lands on the problem instead of hearing an alert about a field somewhere above.
  useEffect(() => {
    if (focusInvalid) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusInvalid]);
  // Any change after a save clears its outcome, so "Saved" never describes values that have since been edited.
  const edited = () => {
    setDirty(true);
    if (mutation.isSuccess || mutation.isError) mutation.reset();
  };
  // A saved team stays listed even when GitHub no longer returns it — losing read:org or leaving the team would otherwise hide the subscription while the form kept posting it back, with no way to remove it. The saved ids are captured once so that clearing a checkbox does not remove its own row.
  const fetched = teams.data?.data || [];
  const teamOptions = [...fetched, ...saved.filter((team) => !fetched.some((entry) => entry.id === team)).map((team) => ({ id: team, name: team }))];
  const scheduleTitle = `${id}-schedule`;
  const teamsTitle = `${id}-teams`;
  const overridesTitle = `${id}-overrides`;
  return (
    // The browser's own required/min/max checks stay on for the schedule fields, as they always were; the waiting-period rows carry no such attributes and are checked by the editor, which can name the row.
    <form
      ref={form}
      className="grid min-w-0 gap-4"
      onChange={edited}
      onSubmit={(event) => {
        event.preventDefault();
        const zoneOk = isTimezone(timezone.trim());
        const result = overridesDays(overrides);
        setTimezoneInvalid(!zoneOk);
        setOverrideProblems("problems" in result ? result.problems : {});
        if (!zoneOk || "problems" in result) {
          setFocusInvalid((count) => count + 1);
          return;
        }
        mutation.mutate(result.days);
      }}
    >
      <SettingsCard title={t("followup.schedule")} titleId={scheduleTitle} description={t("followup.scheduleHelp")}>
        <div className="grid min-w-0 gap-4">
          <Field label={t("followup.timezone")} help={t("followup.timezoneHelp")} error={timezoneInvalid ? t("followup.timezoneInvalid") : undefined} htmlFor={`${id}-timezone`} layout="inline">
            <TextField
              id={`${id}-timezone`}
              className="@pair/dashboard:max-w-80"
              list={zones.length ? `${id}-zones` : undefined}
              value={timezone}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setTimezone(event.target.value);
                setTimezoneInvalid(false);
              }}
              required
              placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
            />
          </Field>
          {zones.length > 0 && (
            <datalist id={`${id}-zones`}>
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          )}
          <Field label={t("followup.digestTime")} help={t("followup.digestTimeHelp")} htmlFor={`${id}-time`} layout="inline">
            <TextField id={`${id}-time`} className="max-w-40" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </Field>
          <Field label={t("followup.waitDays")} help={t("followup.waitDaysHelp")} htmlFor={`${id}-days`} layout="inline">
            <TextField id={`${id}-days`} className="max-w-24" type="number" min={1} max={365} inputMode="numeric" value={days} onChange={(event) => setDays(Number(event.target.value))} required />
          </Field>
          <Field label={t("settings.digestLanguage")} help={t("settings.digestLanguageHelp")} htmlFor={`${id}-language`} layout="inline">
            <select id={`${id}-language`} className={cx(selectClass, "@pair/dashboard:max-w-60")} value={language} onChange={(event) => setLanguage(event.target.value as "en" | "zh-CN")}>
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title={t("followup.teams")} titleId={teamsTitle} description={t("followup.teamsHelp")}>
        {teams.isError && (
          <Notice
            tone="danger"
            role="alert"
            actions={
              <Button size="sm" onClick={() => void teams.refetch()}>
                {t("followup.retry")}
              </Button>
            }
          >
            {t("followup.teamsError")}
          </Notice>
        )}
        {teams.isPending && (
          <div className="grid gap-2" aria-busy="true">
            <span className="sr-only" role="status">
              {t("loading")}
            </span>
            <Skeleton width="min(220px, 100%)" height={20} />
            <Skeleton width="min(180px, 100%)" height={20} />
          </div>
        )}
        {teamOptions.length > 0 ? (
          <div role="group" aria-labelledby={teamsTitle} className="grid min-w-0 gap-1 @pair/dashboard:grid-cols-2">
            {teamOptions.map((team) => (
              <Checkbox key={team.id} label={team.name} description={team.name !== team.id ? team.id : undefined} checked={selected.includes(team.id)} onChange={(event) => setSelected((current) => (event.target.checked ? [...current, team.id] : current.filter((entry) => entry !== team.id)))} />
            ))}
          </div>
        ) : (
          !teams.isPending && !teams.isError && <p className="rounded-md border border-dashed border-line px-3 py-3 text-small text-fg-muted">{t("followup.teamsEmpty")}</p>
        )}
      </SettingsCard>

      <SettingsCard title={t("followup.overrides")} titleId={overridesTitle}>
        <OverridesEditor
          value={overrides}
          onChange={(next) => {
            setOverrides(next);
            edited();
            edited();
          }}
          problems={overrideProblems}
          onProblemsChange={setOverrideProblems}
          defaultDays={days}
          suggestions={suggestions}
          labelledBy={overridesTitle}
        />
      </SettingsCard>

      {/* The form is taller than the screen at every width, so while there is something to save the bar rides along the bottom edge (above the tab bar on a phone) instead of waiting below the fold at the end of the page. `data-save-bar` adds its height to the page's scroll padding, so a field focused under it is scrolled clear. */}
      {(dirty || !mutation.isIdle) && (
        <div data-save-bar="" className="sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+8px)] z-10 flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-1 shell:bottom-4">
          {dirty && !mutation.isPending && !mutation.isError && <span className="mr-auto text-small text-fg-muted">{t("settings.unsaved")}</span>}
          {mutation.isError && (
            <p className="mr-auto min-w-0 flex-1 text-small text-tone-blocked" role="alert">
              {t("followup.saveError")}
            </p>
          )}
          {mutation.isSuccess && !mutation.isPending && (
            <p className="mr-auto inline-flex items-center gap-1.5 text-small font-medium text-tone-ready" role="status">
              <Check size={14} aria-hidden="true" />
              {t("followup.saved")}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={mutation.isPending || !dirty}>
            {mutation.isPending ? t("followup.saving") : t("followup.save")}
          </Button>
        </div>
      )}
    </form>
  );
}

// The Reminders tab reads the stored settings; the other tabs do not need them, so their loading and failure are this panel's alone.
function ReminderSettings() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["follow-up-settings"],
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/follow-up-settings", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => settingsSchema.parse(data)),
    retry: false,
  });
  if (query.isPending)
    return (
      <div className="grid gap-4">
        <span className="sr-only" role="status">
          {t("loading")}
        </span>
        <FormSkeleton fields={4} />
        <FormSkeleton fields={1} />
      </div>
    );
  // A background refetch that fails leaves the settings in hand: replacing the panel then would throw away a half-filled form along with what it shows.
  if (query.isError && !query.data) return <ErrorState title={t("settings.unavailable")} error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="grid min-w-0 gap-4">
      {query.isError && <StaleNotice onRetry={() => void query.refetch()} />}
      <SettingsForm settings={query.data} />
    </div>
  );
}

function DestinationForm({ draft, setDraft, errors, setErrors, allowPrivate, onClose, titleId }: { draft: Draft; setDraft: (next: Draft) => void; errors: Record<string, string>; setErrors: (next: Record<string, string>) => void; allowPrivate: boolean; onClose: () => void; titleId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const id = useId();
  const channelSelect = useRef<HTMLSelectElement>(null);
  const [addFailure, setAddFailure] = useState("");
  const [added, setAdded] = useState({ text: "", id: 0 });
  useEffect(() => {
    channelSelect.current?.focus();
  }, []);
  const addDestination = useMutation({
    mutationFn: () => ky.post(apiURL + "/api/v1/notification-destinations", { credentials: "include", retry: 0, json: destinationPayload(draft) }),
    onError: (error) => setAddFailure(addErrorMessage(error)),
    onSuccess: () => {
      setDraft({ ...emptyDraft, kind: draft.kind });
      setAdded((previous) => ({ text: t("settings.announceAdded"), id: previous.id + 1 }));
      void client.invalidateQueries({ queryKey: ["notification-destinations"] });
    },
  });
  const field = (key: keyof Draft) => ({
    id: `${id}-${key}`,
    value: draft[key],
    onChange: (event: { target: { value: string } }) => {
      setDraft({ ...draft, [key]: event.target.value });
      if (errors[key]) setErrors({ ...errors, [key]: "" });
    },
  });
  const error = (key: string) => (errors[key] ? t(errors[key]) : undefined);
  return (
    <form
      noValidate
      aria-labelledby={titleId}
      className="grid min-w-0 gap-4 rounded-md border border-line bg-surface p-4"
      onChange={() => {
        if (addDestination.isError) addDestination.reset();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const target = event.currentTarget;
        const found = draftErrors(draft, allowPrivate);
        setErrors(found);
        if (Object.values(found).some(Boolean)) {
          requestAnimationFrame(() => target.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
          return;
        }
        addDestination.mutate();
      }}
    >
      <h3 id={titleId} className="text-body font-semibold text-fg">
        {t("settings.newDestination")}
      </h3>
      <p className="sr-only" role="status">
        {added.text && `${added.text}${added.id % 2 ? " " : ""}`}
      </p>
      <div className="grid min-w-0 items-start gap-4 @pair/dashboard:grid-cols-2">
        <Field label={t("followup.channel")} htmlFor={`${id}-kind`}>
          <select
            ref={channelSelect}
            id={`${id}-kind`}
            className={selectClass}
            value={draft.kind}
            onChange={(event) => {
              setDraft({ ...emptyDraft, name: draft.name, kind: event.target.value as Channel });
              setErrors({});
            }}
          >
            {channels.map((channel) => (
              <option key={channel} value={channel}>
                {t(channelLabel(channel))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("followup.destinationName")} help={t("followup.destinationNameHelp")} error={error("name")} htmlFor={`${id}-name`}>
          <TextField {...field("name")} autoComplete="off" />
        </Field>
        <p className="text-small text-fg-muted @pair/dashboard:col-span-2">{t(`followup.${draft.kind}Help`)}</p>
        {draft.kind === "telegram" && (
          <>
            <Field label={t("followup.chatId")} help={t("followup.chatIdHelp")} error={error("chat_id")} htmlFor={`${id}-chat_id`}>
              <TextField {...field("chat_id")} inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label={t("followup.botToken")} help={t("followup.botTokenHelp")} error={error("token")} htmlFor={`${id}-token`}>
              <TextField {...field("token")} type="password" autoComplete="off" />
            </Field>
          </>
        )}
        {(draft.kind === "lark" || draft.kind === "webhook") && (
          <>
            <Field label={t("followup.webhookUrl")} help={t("followup.webhookUrlHelp")} error={error("url")} htmlFor={`${id}-url`} className="@pair/dashboard:col-span-2">
              <TextField {...field("url")} inputMode="url" placeholder="https://" autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t("followup.signingSecret")} help={t("followup.signingSecretHelp")} htmlFor={`${id}-secret`} className="@pair/dashboard:col-span-2">
              <TextField {...field("secret")} type="password" autoComplete="off" />
            </Field>
          </>
        )}
        {draft.kind === "email" && (
          <>
            <Field label={t("followup.smtpHost")} error={error("host")} htmlFor={`${id}-host`}>
              <TextField {...field("host")} placeholder="smtp.example.com" autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t("followup.smtpPort")} help={t("followup.smtpPortHelp")} error={error("port")} htmlFor={`${id}-port`}>
              <TextField {...field("port")} inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label={t("followup.smtpUsername")} help={t("followup.smtpUsernameHelp")} htmlFor={`${id}-username`}>
              <TextField {...field("username")} autoComplete="off" />
            </Field>
            <Field label={t("followup.smtpPassword")} htmlFor={`${id}-password`}>
              <TextField {...field("password")} type="password" autoComplete="off" />
            </Field>
            <Field label={t("followup.emailFrom")} error={error("from")} htmlFor={`${id}-from`}>
              <TextField {...field("from")} inputMode="email" autoComplete="off" />
            </Field>
            <Field label={t("followup.emailTo")} help={t("followup.emailToHelp")} error={error("to")} htmlFor={`${id}-to`}>
              <TextField {...field("to")} inputMode="email" autoComplete="off" />
            </Field>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" icon={Plus} disabled={addDestination.isPending}>
          {addDestination.isPending ? t("followup.adding") : t("followup.add")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("followup.cancel")}
        </Button>
        {addDestination.isError && (
          <p className="min-w-0 basis-full text-small text-tone-blocked" role="alert">
            {addFailure || t("followup.addError")}
          </p>
        )}
      </div>
    </form>
  );
}

function NotificationDestinations() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const id = useId();
  // The form and its draft live here rather than in the form, so closing it is a decision and a trip to another tab is not: the panel stays mounted while hidden.
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removals, setRemovals] = useState(0);
  const openButton = useRef<HTMLButtonElement>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  useEffect(() => {
    if (!returnFocus) return;
    openButton.current?.focus();
    setReturnFocus(false);
  }, [returnFocus]);
  // Removing a destination takes the focused button with it, so the card takes the focus instead of the document, and the removal is said out loud.
  const [announcement, setAnnouncement] = useState({ text: "", id: 0 });
  const region = useRef<HTMLElement>(null);
  const announce = (text: string) => setAnnouncement((previous) => ({ text, id: previous.id + 1 }));
  useEffect(() => {
    if (announcement.id && document.activeElement === document.body) region.current?.focus();
  }, [announcement]);
  const invalidate = () => void client.invalidateQueries({ queryKey: ["notification-destinations"] });
  const destinations = useQuery({ queryKey: ["notification-destinations"], queryFn: ({ signal }) => ky.get(apiURL + "/api/v1/notification-destinations", { credentials: "include", signal }).json<{ data: Destination[]; allow_private_hosts?: boolean }>(), retry: false });
  const updateDestination = useMutation({ mutationFn: (d: Destination) => ky.put(apiURL + `/api/v1/notification-destinations/${d.id}`, { credentials: "include", retry: 0, json: { name: d.name, enabled: !d.enabled } }), onSuccess: invalidate });
  const deleteDestination = useMutation({
    mutationFn: (destination: number) => ky.delete(apiURL + `/api/v1/notification-destinations/${destination}`, { credentials: "include", retry: 0 }),
    onSuccess: () => {
      setRemovals((count) => count + 1);
      announce(t("followup.announceRemoved"));
      invalidate();
    },
  });
  const rows = destinations.data?.data || [];
  const open = () => setFormOpen(true);
  const close = () => {
    setFormOpen(false);
    setDraft(emptyDraft);
    setErrors({});
    setReturnFocus(true);
  };
  const addButton = (
    <Button ref={openButton} icon={Plus} onClick={open}>
      {t("settings.addDestination")}
    </Button>
  );
  const loaded = !destinations.isPending && !(destinations.isError && !destinations.data);
  return (
    <SettingsCard ref={region} tabIndex={-1} title={t("followup.notifications")} description={t("followup.notificationsHelp")} footer={loaded && rows.length > 0 && !formOpen ? addButton : undefined}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.text}
      </p>
      {/* A failed refresh keeps the destinations that were already loaded: they are still accurate, and replacing them with an error hides what the operator came to read. */}
      {destinations.isError && destinations.data && <StaleNotice onRetry={() => void destinations.refetch()} />}
      {destinations.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <span className="sr-only" role="status">
            {t("loading")}
          </span>
          <Skeleton height={44} count={2} className="mb-2" />
        </div>
      ) : destinations.isError && !destinations.data ? (
        <Notice
          tone="danger"
          role="alert"
          actions={
            <Button size="sm" onClick={() => void destinations.refetch()}>
              {t("followup.retry")}
            </Button>
          }
        >
          {t("followup.destinationsError")}
        </Notice>
      ) : rows.length === 0 ? (
        !formOpen && <EmptyState icon={BellRing} title={t("followup.destinationsEmpty")} action={addButton} className="py-6" />
      ) : (
        <ul className="m-0 grid min-w-0 list-none rounded-md border border-line bg-surface p-0">
          {rows.map((destination) => (
            <li key={destination.id} data-testid="destination" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-3 py-2.5 first:border-t-0">
              <div className="grid min-w-0 flex-1 basis-48 gap-1">
                <p className="truncate text-body font-medium text-fg" title={destination.name}>
                  {destination.name}
                </p>
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
                  <Badge>{t(channelLabel(destination.kind || "telegram"))}</Badge>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={cx("size-2 rounded-full", destination.enabled ? "bg-tone-ready" : "border border-fg-subtle")} />
                    {t(destination.enabled ? "followup.destinationEnabled" : "followup.destinationDisabled")}
                  </span>
                  {destination.failing && <FactChip tone="blocked">{t("followup.destinationFailing")}</FactChip>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" busy={updateDestination.isPending && updateDestination.variables?.id === destination.id} disabled={updateDestination.isPending} onClick={() => updateDestination.mutate(destination)}>
                  {t(destination.enabled ? "followup.disable" : "followup.enable")}
                </Button>
                {/* Keyed on the removal count as well, so a row that is still listed after a removal (a stale list) starts again from its trigger rather than from a confirmation nobody asked for. */}
                <ConfirmInline
                  key={`${destination.id}-${removals}`}
                  triggerLabel={t("followup.remove")}
                  question={t("followup.confirmRemove")}
                  confirmLabel={t("followup.remove")}
                  cancelLabel={t("followup.cancel")}
                  busy={deleteDestination.isPending && deleteDestination.variables === destination.id}
                  onConfirm={() => deleteDestination.mutate(destination.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {(updateDestination.isError || deleteDestination.isError) && (
        <p className="text-small text-tone-blocked" role="alert">
          {t("followup.destinationActionError")}
        </p>
      )}
      {formOpen && <DestinationForm draft={draft} setDraft={setDraft} errors={errors} setErrors={setErrors} allowPrivate={destinations.data?.allow_private_hosts === true} onClose={close} titleId={`${id}-new`} />}
    </SettingsCard>
  );
}

// The URL value of each tab. Reminders is the default and carries no parameter, which keeps /settings itself clean; the others keep the names links already use.
const settingsTabs = ["schedule", "notifications", "github", "access"] as const;
type SettingsTab = (typeof settingsTabs)[number];
const tabLabels: Record<SettingsTab, string> = { schedule: "followup.tabSchedule", notifications: "followup.tabNotifications", github: "settings.tabGitHub", access: "followup.tabAccess" };

export function FollowUpSettings() {
  const { t } = useTranslation();
  // The open tab lives in the URL so a reload, a shared link and the back button all land on the same one.
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") || "";
  const active: SettingsTab = (settingsTabs as readonly string[]).includes(requested) ? (requested as SettingsTab) : "schedule";
  const select = (tab: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (tab === "schedule") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };
  return (
    <div className="grid w-full max-w-[720px] min-w-0 gap-4">
      <PageHeader title={t("followup.settings")} />
      {/* A two-character label ("通知") is narrower than a fingertip, and the primitive only raises a tab's height on a coarse pointer, so the width floor is set here. */}
      {/* Radix carries the roving tab order and the arrow keys; the Tabs primitive keeps a visited panel mounted and hidden, so a half-filled form survives a trip to another tab while a tab never opened costs no request. */}
      <Tabs value={active} onValueChange={select} label={t("followup.settings")} items={settingsTabs.map((tab) => ({ value: tab, label: t(tabLabels[tab]) }))} panelClassName="min-w-0 gap-4 data-[state=active]:grid">
        {(tab) => (tab === "schedule" ? <ReminderSettings /> : tab === "notifications" ? <NotificationDestinations /> : tab === "github" ? <GitHubAccessPanel variant="full" /> : <AccessSettings />)}
      </Tabs>
    </div>
  );
}
