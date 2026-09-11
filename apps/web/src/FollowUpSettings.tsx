import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ky from "ky";
import { z } from "zod";
import { apiURL } from "./api-url";

const settingsSchema = z.object({ timezone: z.string(), digest_time: z.string(), wait_days: z.number(), language: z.enum(["en", "zh-CN"]).default("en"), teams: z.array(z.string()).nullable(), repository_days: z.record(z.string(), z.number()).nullable() });
type Settings = z.infer<typeof settingsSchema>;
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
  const destinations = useQuery({ queryKey: ["notification-destinations"], queryFn: () => ky.get(apiURL + "/api/v1/notification-destinations", { credentials: "include" }).json<{ data: { id: number; name: string; enabled: boolean }[] }>(), retry: false });
  const [telegram, setTelegram] = useState({ name: "", token: "", chat_id: "" });
  const addDestination = useMutation({
    mutationFn: () => ky.post(apiURL + "/api/v1/notification-destinations", { credentials: "include", json: { name: telegram.name, token: telegram.token, chat_id: Number(telegram.chat_id) } }),
    onSuccess: () => {
      setTelegram({ name: "", token: "", chat_id: "" });
      void client.invalidateQueries({ queryKey: ["notification-destinations"] });
    },
  });
  const updateDestination = useMutation({
    mutationFn: (d: { id: number; name: string; enabled: boolean }) => ky.put(apiURL + `/api/v1/notification-destinations/${d.id}`, { credentials: "include", json: { name: d.name, enabled: !d.enabled } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["notification-destinations"] }),
  });
  const deleteDestination = useMutation({ mutationFn: (id: number) => ky.delete(apiURL + `/api/v1/notification-destinations/${id}`, { credentials: "include" }), onSuccess: () => void client.invalidateQueries({ queryKey: ["notification-destinations"] }) });
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
    mutationFn: () => {
      const repository_days: Record<string, number> = {};
      for (const line of overrides
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)) {
        const match = line.match(/^([\w.-]+\/[\w.-]+)=(\d+)$/);
        if (!match) throw new Error("Invalid repository override");
        repository_days[match[1]] = Number(match[2]);
      }
      return ky.post(apiURL + "/api/v1/follow-up-settings", { credentials: "include", json: { timezone, digest_time: time, wait_days: days, language, teams: selected, repository_days } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["follow-up-settings"] });
      void client.invalidateQueries({ queryKey: ["follow-ups"] });
    },
  });
  return (
    <form
      className="followup-settings"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="followup-setting-fields">
        <label>
          Notification language
          <select value={language} onChange={(e) => setLanguage(e.target.value as "en" | "zh-CN")}>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>
        <label>
          {t("followup.timezone")}
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} required placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone} />
        </label>
        <label>
          {t("followup.digestTime")}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label>
          {t("followup.waitDays")}
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} required />
        </label>
      </div>
      <fieldset>
        <legend>{t("followup.teams")}</legend>
        <p>{t("followup.teamsHelp")}</p>
        {teams.isError && (
          <p role="alert">
            {t("followup.teamsError")}{" "}
            <button type="button" onClick={() => teams.refetch()}>
              {t("followup.retry")}
            </button>
          </p>
        )}
        {teams.isPending && <p>{t("loading")}</p>}
        {(teams.data?.data || selected.map((id) => ({ id, name: id }))).map((team) => (
          <label key={team.id} className="followup-team">
            <input type="checkbox" checked={selected.includes(team.id)} onChange={(e) => setSelected((current) => (e.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id)))} />
            {team.id}
          </label>
        ))}
      </fieldset>
      <label>
        {t("followup.overrides")}
        <textarea rows={4} value={overrides} onChange={(e) => setOverrides(e.target.value)} placeholder="owner/repository=14" />
        <small>{t("followup.overridesHelp")}</small>
      </label>
      {mutation.isError && <p role="alert">{t("followup.saveError")}</p>}
      {mutation.isSuccess && <p role="status">{t("followup.saved")}</p>}
      <button className="secondary-action" type="submit" disabled={mutation.isPending}>
        {t("followup.save")}
      </button>
      <fieldset>
        <legend>Telegram notifications</legend>
        <div className="followup-setting-fields">
          <input aria-label="Telegram name" placeholder="Name" value={telegram.name} onChange={(e) => setTelegram({ ...telegram, name: e.target.value })} />
          <input aria-label="Telegram bot token" placeholder="Bot token" value={telegram.token} onChange={(e) => setTelegram({ ...telegram, token: e.target.value })} />
          <input aria-label="Telegram chat ID" placeholder="Chat ID" value={telegram.chat_id} onChange={(e) => setTelegram({ ...telegram, chat_id: e.target.value })} />
          <button type="button" onClick={() => addDestination.mutate()} disabled={addDestination.isPending}>
            Add
          </button>
        </div>
        {destinations.data?.data.map((d) => (
          <div key={d.id}>
            {d.name} · {d.enabled ? "enabled" : "disabled"}{" "}
            <button type="button" onClick={() => updateDestination.mutate(d)}>
              {d.enabled ? "Disable" : "Enable"}
            </button>{" "}
            <button type="button" onClick={() => deleteDestination.mutate(d.id)}>
              Delete
            </button>
          </div>
        ))}
      </fieldset>
    </form>
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
    <section>
      <h2>{t("followup.settings")}</h2>
      <SettingsForm settings={query.data} />
    </section>
  );
}
