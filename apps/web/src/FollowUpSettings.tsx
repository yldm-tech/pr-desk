import { useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";

const settingsSchema = z.object({ timezone: z.string(), digest_time: z.string(), wait_days: z.number(), language: z.enum(["en", "zh-CN"]).default("en"), teams: z.array(z.string()).nullable(), repository_days: z.record(z.string(), z.number()).nullable() });
type Settings = z.infer<typeof settingsSchema>;
type Destination = { id: number; name: string; enabled: boolean };
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
    mutationFn: (repository_days: Record<string, number>) => ky.post(apiURL + "/api/v1/follow-up-settings", { credentials: "include", json: { timezone: timezone.trim(), digest_time: time, wait_days: days, language, teams: selected, repository_days } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["follow-up-settings"] });
      void client.invalidateQueries({ queryKey: ["follow-ups"] });
    },
  });
  const teamOptions = teams.data?.data || selected.map((id) => ({ id, name: id }));
  return (
    <form
      className="followup-settings"
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
  const [telegram, setTelegram] = useState({ name: "", token: "", chat_id: "" });
  const [errors, setErrors] = useState({ name: false, token: false, chat_id: false });
  const [confirming, setConfirming] = useState(0);
  const invalidate = () => void client.invalidateQueries({ queryKey: ["notification-destinations"] });
  const destinations = useQuery({ queryKey: ["notification-destinations"], queryFn: ({ signal }) => ky.get(apiURL + "/api/v1/notification-destinations", { credentials: "include", signal }).json<{ data: Destination[] }>(), retry: false });
  const addDestination = useMutation({
    mutationFn: () => ky.post(apiURL + "/api/v1/notification-destinations", { credentials: "include", json: { name: telegram.name.trim(), token: telegram.token.trim(), chat_id: Number(telegram.chat_id.trim()) } }),
    onSuccess: () => {
      setTelegram({ name: "", token: "", chat_id: "" });
      invalidate();
    },
  });
  const updateDestination = useMutation({ mutationFn: (d: Destination) => ky.put(apiURL + `/api/v1/notification-destinations/${d.id}`, { credentials: "include", json: { name: d.name, enabled: !d.enabled } }), onSuccess: invalidate });
  const deleteDestination = useMutation({
    mutationFn: (id: number) => ky.delete(apiURL + `/api/v1/notification-destinations/${id}`, { credentials: "include" }),
    onSuccess: () => {
      setConfirming(0);
      invalidate();
    },
  });
  const rows = destinations.data?.data || [];
  return (
    <section className="followup-settings" aria-labelledby="notification-destinations-heading">
      <div className="followup-settings-group">
        <div className="followup-settings-heading">
          <h2 id="notification-destinations-heading">{t("followup.telegram")}</h2>
          <p>{t("followup.telegramHelp")}</p>
        </div>
        <form
          className="followup-destination-form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = { name: !telegram.name.trim(), token: !telegram.token.trim(), chat_id: !/^-?\d+$/.test(telegram.chat_id.trim()) };
            setErrors(next);
            if (next.name || next.token || next.chat_id) return;
            addDestination.mutate();
          }}
        >
          <Field label={t("followup.destinationName")} hint={t("followup.destinationNameHelp")} error={errors.name ? t("followup.required") : undefined}>
            {(props) => (
              <input
                {...props}
                value={telegram.name}
                onChange={(e) => {
                  setTelegram({ ...telegram, name: e.target.value });
                  setErrors({ ...errors, name: false });
                }}
              />
            )}
          </Field>
          <Field label={t("followup.chatId")} hint={t("followup.chatIdHelp")} error={errors.chat_id ? t("followup.chatIdInvalid") : undefined}>
            {(props) => (
              <input
                {...props}
                inputMode="numeric"
                value={telegram.chat_id}
                onChange={(e) => {
                  setTelegram({ ...telegram, chat_id: e.target.value });
                  setErrors({ ...errors, chat_id: false });
                }}
              />
            )}
          </Field>
          <Field label={t("followup.botToken")} hint={t("followup.botTokenHelp")} error={errors.token ? t("followup.required") : undefined} wide>
            {(props) => (
              <input
                {...props}
                type="password"
                autoComplete="off"
                value={telegram.token}
                onChange={(e) => {
                  setTelegram({ ...telegram, token: e.target.value });
                  setErrors({ ...errors, token: false });
                }}
              />
            )}
          </Field>
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
        .get(apiURL + "/api/v1/follow-up-settings", { credentials: "include", signal })
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
    <div className="followup-settings-page">
      <SettingsForm settings={query.data} />
      <NotificationDestinations />
    </div>
  );
}
