import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";
import { AccessSettings } from "./AccessSettings";

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
// The server parses addresses with net/mail, which accepts a display name. The
// browser check stays deliberately narrower than RFC 5322 but has to allow the
// same two spellings so the form does not reject what the server stores.
const emailPattern = /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;
const recipientList = (value: string) =>
  value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

// The server refuses to dial private addresses, so the same families are
// reported in the form instead of after a failed delivery attempt.
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

// allowPrivate mirrors NOTIFY_ALLOW_PRIVATE_HOSTS on the server: with it the
// server also accepts plain http, because internal endpoints rarely have a
// certificate, and the form has to accept the same addresses it does.
function draftErrors(draft: Draft, allowPrivate: boolean): Record<string, string> {
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
    if (!draft.host.trim()) found.host = "followup.required";
    else if (!allowPrivate && isPrivateHost(draft.host)) found.host = "followup.privateUrl";
    const port = Number(draft.port.trim());
    if (draft.port.trim() && !(Number.isInteger(port) && port >= 1 && port <= 65535)) found.port = "followup.invalidPort";
    if (!emailPattern.test(draft.from.trim())) found.from = "followup.invalidEmail";
    const recipients = recipientList(draft.to);
    if (!recipients.length || recipients.some((entry) => !emailPattern.test(entry))) found.to = "followup.invalidEmail";
    else if (recipients.length > recipientLimit) found.to = "followup.tooManyRecipients";
  }
  return found;
}

function destinationPayload(draft: Draft) {
  const base = { kind: draft.kind, name: draft.name.trim() };
  if (draft.kind === "telegram") return { ...base, token: draft.token.trim(), chat_id: Number(draft.chat_id.trim()) };
  if (draft.kind === "email") return { ...base, host: draft.host.trim(), port: Number(draft.port.trim()) || 587, username: draft.username.trim(), password: draft.password, from: draft.from.trim(), to: recipientList(draft.to) };
  return { ...base, url: draft.url.trim(), secret: draft.secret.trim() };
}
type ControlProps = { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined };

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
const parseOverrides = (text: string): { days: Record<string, number> } | { invalidLine: number } => {
  const days: Record<string, number> = {};
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const match = line.match(/^([\w.-]+\/[\w.-]+)=(\d+)$/);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 365) return { invalidLine: index + 1 };
    days[match[1]] = Number(match[2]);
  }
  return { days };
};

function Field({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string; wide?: boolean; children: (props: ControlProps) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <div className={wide ? "followup-field followup-field-wide" : "followup-field"}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": describedBy || undefined, "aria-invalid": error ? true : undefined })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <p className="followup-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [timezone, setTimezone] = useState(settings.timezone);
  const [time, setTime] = useState(settings.digest_time);
  const [days, setDays] = useState(settings.wait_days);
  const [language, setLanguage] = useState(settings.language);
  const [selected, setSelected] = useState(settings.teams || []);
  const [saved] = useState(() => settings.teams || []);
  const [overrides, setOverrides] = useState(
    Object.entries(settings.repository_days || {})
      .map(([repo, value]) => `${repo}=${value}`)
      .join("\n"),
  );
  const [timezoneInvalid, setTimezoneInvalid] = useState(false);
  const [invalidLine, setInvalidLine] = useState(0);
  const zonesId = useId();
  const zones = useMemo(supportedTimezones, []);
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
      void client.invalidateQueries({ queryKey: ["follow-up-settings"] });
      void client.invalidateQueries({ queryKey: ["follow-ups"] });
    },
  });
  // A saved team stays listed even when GitHub no longer returns it — losing
  // read:org or leaving the team would otherwise hide the subscription while
  // the form kept posting it back, with no way to remove it. The saved ids are
  // captured once so that clearing a checkbox does not remove its own row.
  const fetched = teams.data?.data || [];
  const teamOptions = [...fetched, ...saved.filter((id) => !fetched.some((team) => team.id === id)).map((id) => ({ id, name: id }))];
  return (
    <form
      className="followup-settings"
      onChange={() => {
        if (mutation.isSuccess || mutation.isError) mutation.reset();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseOverrides(overrides);
        const zoneOk = isTimezone(timezone.trim());
        setTimezoneInvalid(!zoneOk);
        setInvalidLine("invalidLine" in parsed ? parsed.invalidLine : 0);
        if (!zoneOk || !("days" in parsed)) return;
        mutation.mutate(parsed.days);
      }}
    >
      <div className="followup-settings-group">
        <div className="followup-settings-heading">
          <h2>{t("followup.schedule")}</h2>
          <p>{t("followup.scheduleHelp")}</p>
        </div>
        <div className="followup-setting-fields">
          <Field label={t("followup.notificationLanguage")} hint={t("followup.notificationLanguageHelp")}>
            {(props) => (
              <select {...props} value={language} onChange={(e) => setLanguage(e.target.value as "en" | "zh-CN")}>
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            )}
          </Field>
          <Field label={t("followup.timezone")} hint={t("followup.timezoneHelp")} error={timezoneInvalid ? t("followup.timezoneInvalid") : undefined}>
            {(props) => (
              <>
                <input
                  {...props}
                  list={zones.length ? zonesId : undefined}
                  value={timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    setTimezoneInvalid(false);
                  }}
                  required
                  placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
                />
                {zones.length > 0 && (
                  <datalist id={zonesId}>
                    {zones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                )}
              </>
            )}
          </Field>
          <Field label={t("followup.digestTime")} hint={t("followup.digestTimeHelp")}>
            {(props) => <input {...props} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />}
          </Field>
          <Field label={t("followup.waitDays")} hint={t("followup.waitDaysHelp")}>
            {(props) => <input {...props} type="number" min={1} max={365} inputMode="numeric" value={days} onChange={(e) => setDays(Number(e.target.value))} required />}
          </Field>
        </div>
      </div>
      <fieldset className="followup-settings-group">
        <legend>{t("followup.teams")}</legend>
        <p className="followup-settings-note">{t("followup.teamsHelp")}</p>
        {teams.isError && (
          <p className="followup-settings-warning" role="alert">
            <span>{t("followup.teamsError")}</span>
            <button className="secondary-action" type="button" onClick={() => teams.refetch()}>
              {t("followup.retry")}
            </button>
          </p>
        )}
        {teams.isPending && <p className="followup-settings-note">{t("loading")}</p>}
        {teamOptions.length > 0 ? (
          <div className="followup-team-list">
            {teamOptions.map((team) => (
              <label key={team.id} className="followup-team">
                <input type="checkbox" checked={selected.includes(team.id)} onChange={(e) => setSelected((current) => (e.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id)))} />
                <span>
                  {team.name}
                  {team.name !== team.id && <small>{team.id}</small>}
                </span>
              </label>
            ))}
          </div>
        ) : (
          !teams.isPending && !teams.isError && <p className="followup-empty-note">{t("followup.teamsEmpty")}</p>
        )}
      </fieldset>
      <div className="followup-settings-group">
        <Field label={t("followup.overrides")} hint={t("followup.overridesHelp")} error={invalidLine ? t("followup.overridesInvalid", { line: invalidLine }) : undefined} wide>
          {(props) => (
            <textarea
              {...props}
              rows={4}
              value={overrides}
              onChange={(e) => {
                setOverrides(e.target.value);
                setInvalidLine(0);
              }}
              placeholder="owner/repository=14"
            />
          )}
        </Field>
      </div>
      <div className="followup-settings-actions">
        <button className="primary-action" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t("followup.saving") : t("followup.save")}
        </button>
        {mutation.isError && (
          <p className="followup-field-error" role="alert">
            {t("followup.saveError")}
          </p>
        )}
        {mutation.isSuccess && !mutation.isPending && (
          <p className="followup-save-status" role="status">
            <Check size={14} aria-hidden="true" />
            {t("followup.saved")}
          </p>
        )}
      </div>
    </form>
  );
}

function NotificationDestinations() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(0);
  // Removing a destination takes the focused button with it and said nothing.
  const [announcement, setAnnouncement] = useState({ text: "", id: 0 });
  const region = useRef<HTMLDivElement>(null);
  const announce = (text: string) => setAnnouncement((previous) => ({ text, id: previous.id + 1 }));
  useEffect(() => {
    if (announcement.id && document.activeElement === document.body) region.current?.focus();
  }, [announcement]);
  const invalidate = () => void client.invalidateQueries({ queryKey: ["notification-destinations"] });
  const destinations = useQuery({ queryKey: ["notification-destinations"], queryFn: ({ signal }) => ky.get(apiURL + "/api/v1/notification-destinations", { credentials: "include", signal }).json<{ data: Destination[]; allow_private_hosts?: boolean }>(), retry: false });
  const addDestination = useMutation({
    mutationFn: () => ky.post(apiURL + "/api/v1/notification-destinations", { credentials: "include", retry: 0, json: destinationPayload(draft) }),
    onSuccess: () => {
      setDraft({ ...emptyDraft, kind: draft.kind });
      invalidate();
    },
  });
  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => {
      setDraft({ ...draft, [key]: event.target.value });
      if (errors[key]) setErrors({ ...errors, [key]: "" });
    },
  });
  const updateDestination = useMutation({ mutationFn: (d: Destination) => ky.put(apiURL + `/api/v1/notification-destinations/${d.id}`, { credentials: "include", retry: 0, json: { name: d.name, enabled: !d.enabled } }), onSuccess: invalidate });
  const deleteDestination = useMutation({
    mutationFn: (id: number) => ky.delete(apiURL + `/api/v1/notification-destinations/${id}`, { credentials: "include", retry: 0 }),
    onSuccess: () => {
      setConfirming(0);
      announce(t("followup.announceRemoved"));
      invalidate();
    },
  });
  const rows = destinations.data?.data || [];
  return (
    <section className="followup-settings" aria-labelledby="notification-destinations-heading">
      <div className="followup-settings-group" ref={region} tabIndex={-1}>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement.text}
        </p>
        <div className="followup-settings-heading">
          <h2 id="notification-destinations-heading">{t("followup.notifications")}</h2>
          <p>{t("followup.notificationsHelp")}</p>
        </div>
        <form
          className="followup-destination-form"
          onChange={() => {
            if (addDestination.isError) addDestination.reset();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const found = draftErrors(draft, destinations.data?.allow_private_hosts === true);
            setErrors(found);
            if (Object.values(found).some(Boolean)) return;
            addDestination.mutate();
          }}
        >
          <Field label={t("followup.channel")}>
            {(props) => (
              <select
                {...props}
                value={draft.kind}
                onChange={(e) => {
                  setDraft({ ...emptyDraft, name: draft.name, kind: e.target.value as Channel });
                  setErrors({});
                }}
              >
                {channels.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(channelLabel(channel))}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("followup.destinationName")} hint={t("followup.destinationNameHelp")} error={errors.name ? t(errors.name) : undefined}>
            {(props) => <input {...props} {...field("name")} />}
          </Field>
          <p className="followup-settings-note followup-field-wide">{t(`followup.${draft.kind}Help`)}</p>
          {draft.kind === "telegram" && (
            <>
              <Field label={t("followup.chatId")} hint={t("followup.chatIdHelp")} error={errors.chat_id ? t(errors.chat_id) : undefined}>
                {(props) => <input {...props} {...field("chat_id")} inputMode="numeric" />}
              </Field>
              <Field label={t("followup.botToken")} hint={t("followup.botTokenHelp")} error={errors.token ? t(errors.token) : undefined}>
                {(props) => <input {...props} {...field("token")} type="password" autoComplete="off" />}
              </Field>
            </>
          )}
          {(draft.kind === "lark" || draft.kind === "webhook") && (
            <>
              <Field label={t("followup.webhookUrl")} hint={t("followup.webhookUrlHelp")} error={errors.url ? t(errors.url) : undefined} wide>
                {(props) => <input {...props} {...field("url")} inputMode="url" placeholder="https://" />}
              </Field>
              <Field label={t("followup.signingSecret")} hint={t("followup.signingSecretHelp")} wide>
                {(props) => <input {...props} {...field("secret")} type="password" autoComplete="off" />}
              </Field>
            </>
          )}
          {draft.kind === "email" && (
            <>
              <Field label={t("followup.smtpHost")} error={errors.host ? t(errors.host) : undefined}>
                {(props) => <input {...props} {...field("host")} placeholder="smtp.example.com" />}
              </Field>
              <Field label={t("followup.smtpPort")} hint={t("followup.smtpPortHelp")} error={errors.port ? t(errors.port) : undefined}>
                {(props) => <input {...props} {...field("port")} inputMode="numeric" />}
              </Field>
              <Field label={t("followup.smtpUsername")} hint={t("followup.smtpUsernameHelp")}>
                {(props) => <input {...props} {...field("username")} autoComplete="off" />}
              </Field>
              <Field label={t("followup.smtpPassword")}>{(props) => <input {...props} {...field("password")} type="password" autoComplete="off" />}</Field>
              <Field label={t("followup.emailFrom")} error={errors.from ? t(errors.from) : undefined}>
                {(props) => <input {...props} {...field("from")} inputMode="email" />}
              </Field>
              <Field label={t("followup.emailTo")} hint={t("followup.emailToHelp")} error={errors.to ? t(errors.to) : undefined}>
                {(props) => <input {...props} {...field("to")} inputMode="email" />}
              </Field>
            </>
          )}
          <div className="followup-destination-actions">
            <button className="secondary-action" type="submit" disabled={addDestination.isPending}>
              <Plus size={15} aria-hidden="true" />
              {addDestination.isPending ? t("followup.adding") : t("followup.add")}
            </button>
            {addDestination.isError && (
              <p className="followup-field-error" role="alert">
                {t("followup.addError")}
              </p>
            )}
          </div>
        </form>
        {destinations.isError ? (
          <p className="followup-settings-warning" role="alert">
            <span>{t("followup.destinationsError")}</span>
            <button className="secondary-action" type="button" onClick={() => destinations.refetch()}>
              {t("followup.retry")}
            </button>
          </p>
        ) : rows.length === 0 && !destinations.isPending ? (
          <p className="followup-empty-note">{t("followup.destinationsEmpty")}</p>
        ) : (
          <ul className="followup-destination-list">
            {rows.map((destination) => (
              <li key={destination.id} className="followup-destination">
                <strong>{destination.name}</strong>
                <span className="followup-destination-kind">{t(channelLabel(destination.kind || "telegram"))}</span>
                {destination.failing && <span className="followup-destination-failing">{t("followup.destinationFailing")}</span>}
                {confirming === destination.id ? (
                  <>
                    <span className="followup-destination-confirm">{t("followup.confirmRemove")}</span>
                    <button className="secondary-action followup-destination-danger" type="button" disabled={deleteDestination.isPending} onClick={() => deleteDestination.mutate(destination.id)}>
                      {t("followup.remove")}
                    </button>
                    <button className="secondary-action" type="button" onClick={() => setConfirming(0)}>
                      {t("followup.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="followup-destination-state" data-state={destination.enabled ? "enabled" : "disabled"}>
                      {t(destination.enabled ? "followup.destinationEnabled" : "followup.destinationDisabled")}
                    </span>
                    <button className="secondary-action" type="button" disabled={updateDestination.isPending} onClick={() => updateDestination.mutate(destination)}>
                      {t(destination.enabled ? "followup.disable" : "followup.enable")}
                    </button>
                    <button className="secondary-action followup-destination-danger" type="button" onClick={() => setConfirming(destination.id)}>
                      {t("followup.remove")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {(updateDestination.isError || deleteDestination.isError) && (
          <p className="followup-field-error" role="alert">
            {t("followup.destinationActionError")}
          </p>
        )}
      </div>
    </section>
  );
}

export function FollowUpSettings() {
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
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  if (query.isError)
    return (
      <p role="alert">
        {t("followup.unavailable")} <a href={apiURL + "/api/v1/auth/github"}>{t("followup.reconnect")}</a>
      </p>
    );
  return (
    // Two explicit columns rather than letting the cards flow: the grid would
    // align them into rows of equal height, and these sections differ too much
    // in length for that to leave anything but gaps.
    <div className="followup-settings-page">
      <div className="followup-settings-column">
        <SettingsForm settings={query.data} />
        <NotificationDestinations />
      </div>
      <div className="followup-settings-column">
        <AccessSettings />
      </div>
    </div>
  );
}
