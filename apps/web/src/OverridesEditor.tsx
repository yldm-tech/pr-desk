import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Plus, X } from "lucide-react";
import { Button, cx, IconButton, Textarea, TextField } from "./ui-controls";

// One repository and its own waiting period. `days` is the text in the field, not a number, so a half-typed value survives until the reader saves. `key` only identifies the row to React and to the focus handling.
export type OverrideRow = { key: number; repo: string; days: string };
// The editor shows either the structured rows or the text form the page has always had; both hold the same `repository_days`.
export type OverridesValue = { mode: "rows" | "text"; rows: OverrideRow[]; text: string };
// What the last save attempt found wrong: an i18n key per row field, or the first bad line of the text form.
export type RowProblems = Record<number, { repo?: string; days?: string }>;
export type OverrideProblems = { rows?: RowProblems; line?: number; refused?: boolean };

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;
const validDays = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365;

let lastKey = 0;
const nextKey = () => ++lastKey;

// The text form: one owner/repository=days per line, blank lines ignored. The first line that does not fit is reported by number, which is what the text view shows the reader.
export const parseOverrides = (text: string): { days: Record<string, number> } | { invalidLine: number } => {
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

export function rowsFromDays(days: Record<string, number> | null | undefined): OverrideRow[] {
  return Object.entries(days || {}).map(([repo, value]) => ({ key: nextKey(), repo, days: String(value) }));
}

// Rows that are entirely empty are dropped rather than written as a bare "=", so adding a row and switching views does not leave a line the text view then refuses.
export function rowsToText(rows: OverrideRow[]): string {
  return rows
    .filter((row) => row.repo.trim() || row.days.trim())
    .map((row) => `${row.repo.trim()}=${row.days.trim()}`)
    .join("\n");
}

export function textToRows(text: string): OverrideRow[] | { invalidLine: number } {
  const parsed = parseOverrides(text);
  return "invalidLine" in parsed ? parsed : rowsFromDays(parsed.days);
}

// The rows as the server stores them, or the problem on each row that stops them from being saved. An empty row is ignored; a repository listed twice is reported on its second row, because the text form silently kept the last one and the structured form can say so instead.
export function checkRows(rows: OverrideRow[]): { days: Record<string, number> } | { problems: RowProblems } {
  const days: Record<string, number> = {};
  const problems: RowProblems = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const repo = row.repo.trim();
    const value = row.days.trim();
    if (!repo && !value) continue;
    const found: { repo?: string; days?: string } = {};
    if (!repositoryPattern.test(repo)) found.repo = "settings.overrideRepoInvalid";
    else if (seen.has(repo.toLowerCase())) found.repo = "settings.overrideDuplicate";
    if (!validDays(value)) found.days = "settings.overrideDaysInvalid";
    seen.add(repo.toLowerCase());
    if (found.repo || found.days) problems[row.key] = found;
    else days[repo] = Number(value);
  }
  return Object.keys(problems).length ? { problems } : { days };
}

// The value to save from whichever view is open, or what is wrong with it.
export function overridesDays(value: OverridesValue): { days: Record<string, number> } | { problems: OverrideProblems } {
  if (value.mode === "text") {
    const parsed = parseOverrides(value.text);
    return "invalidLine" in parsed ? { problems: { line: parsed.invalidLine } } : parsed;
  }
  const checked = checkRows(value.rows);
  return "problems" in checked ? { problems: { rows: checked.problems } } : checked;
}

export function OverridesEditor({
  value,
  onChange,
  problems,
  onProblemsChange,
  defaultDays,
  suggestions,
  labelledBy,
}: {
  value: OverridesValue;
  onChange: (next: OverridesValue) => void;
  problems: OverrideProblems;
  onProblemsChange: (next: OverrideProblems) => void;
  defaultDays: number;
  suggestions: string[];
  labelledBy: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const listId = `${id}-repositories`;
  const addButton = useRef<HTMLButtonElement>(null);
  // Where the focus goes once the next render has put the row there: the new row's repository after Add, the neighbouring row after Remove.
  const [focusKey, setFocusKey] = useState<number | "add" | null>(null);
  useEffect(() => {
    if (focusKey === null) return;
    if (focusKey === "add") addButton.current?.focus();
    else document.getElementById(`${id}-repo-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, id]);

  const updateRow = (key: number, field: "repo" | "days", text: string) => {
    onChange({ ...value, rows: value.rows.map((row) => (row.key === key ? { ...row, [field]: text } : row)) });
    const current = problems.rows?.[key];
    if (current?.[field]) onProblemsChange({ ...problems, rows: { ...problems.rows, [key]: { ...current, [field]: undefined } } });
  };
  const addRow = () => {
    const row = { key: nextKey(), repo: "", days: String(defaultDays) };
    onChange({ ...value, rows: [...value.rows, row] });
    setFocusKey(row.key);
  };
  const removeRow = (key: number) => {
    const index = value.rows.findIndex((row) => row.key === key);
    const rest = value.rows.filter((row) => row.key !== key);
    onChange({ ...value, rows: rest });
    if (problems.rows?.[key]) {
      const { [key]: _removed, ...others } = problems.rows;
      onProblemsChange({ ...problems, rows: others });
    }
    setFocusKey(rest[Math.min(index, rest.length - 1)]?.key ?? "add");
  };
  // Switching views carries the current value across. The text view will not turn back into rows while a line does not parse: the rows could only drop that line, and dropping what the reader typed without saying so is worse than asking them to fix it.
  const toggle = () => {
    if (value.mode === "rows") {
      onChange({ ...value, mode: "text", text: rowsToText(value.rows) });
      onProblemsChange({});
      return;
    }
    const rows = textToRows(value.text);
    if ("invalidLine" in rows) {
      onProblemsChange({ line: rows.invalidLine, refused: true });
      return;
    }
    onChange({ ...value, mode: "rows", rows });
    onProblemsChange({});
  };

  const textMode = value.mode === "text";
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="grid min-w-0 gap-3">
      {textMode ? (
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-text`} className="sr-only">
            {t("followup.overrides")}
          </label>
          <Textarea
            id={`${id}-text`}
            rows={5}
            value={value.text}
            placeholder="owner/repository=14"
            aria-invalid={problems.line ? true : undefined}
            aria-describedby={[problems.line ? errorId : "", helpId].filter(Boolean).join(" ")}
            onChange={(event) => {
              onChange({ ...value, text: event.target.value });
              if (problems.line) onProblemsChange({});
            }}
          />
          {problems.line ? (
            <p id={errorId} role="alert" className="text-caption text-tone-blocked">
              {t("followup.overridesInvalid", { line: problems.line })}
              {problems.refused && ` ${t("settings.overridesFixText")}`}
            </p>
          ) : null}
          <p id={helpId} className="text-caption text-fg-muted">
            {t("followup.overridesHelp")}
          </p>
        </div>
      ) : (
        <div role="group" aria-labelledby={labelledBy} aria-describedby={helpId} className="grid min-w-0 gap-2">
          <p id={helpId} className="text-caption text-fg-muted">
            {t("settings.overridesListHelp")}
          </p>
          {value.rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-3 text-small text-fg-muted">{t("settings.overridesEmpty")}</p>
          ) : (
            <>
              {/* Column captions for the eye; each field carries its own name for assistive technology, so the captions are hidden from it. */}
              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_6rem_2rem] gap-2 text-caption font-medium text-fg-muted @split/dashboard:grid pointer-coarse:grid-cols-[minmax(0,1fr)_6rem_2.75rem]">
                <span>{t("settings.overrideRepo")}</span>
                <span>{t("settings.overrideDays")}</span>
              </div>
              <ul className="m-0 grid list-none gap-2 p-0">
                {value.rows.map((row) => {
                  const found = problems.rows?.[row.key];
                  const repoError = found?.repo ? `${id}-repo-${row.key}-error` : undefined;
                  const daysError = found?.days ? `${id}-days-${row.key}-error` : undefined;
                  return (
                    <li key={row.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_auto] items-start gap-2 @split/dashboard:grid-cols-[minmax(0,1fr)_6rem_auto]">
                      <TextField
                        id={`${id}-repo-${row.key}`}
                        aria-label={t("settings.overrideRepo")}
                        list={suggestions.length ? listId : undefined}
                        value={row.repo}
                        placeholder="owner/repository"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={found?.repo ? true : undefined}
                        aria-describedby={repoError}
                        onChange={(event) => updateRow(row.key, "repo", event.target.value)}
                      />
                      <TextField aria-label={t("settings.overrideDays")} type="number" inputMode="numeric" value={row.days} aria-invalid={found?.days ? true : undefined} aria-describedby={daysError} onChange={(event) => updateRow(row.key, "days", event.target.value)} />
                      <IconButton label={row.repo.trim() ? t("settings.removeOverride", { repo: row.repo.trim() }) : t("settings.removeEmptyOverride")} icon={X} onClick={() => removeRow(row.key)} />
                      {(found?.repo || found?.days) && (
                        <div className="col-span-full grid gap-0.5">
                          {found.repo && (
                            <p id={repoError} role="alert" className="text-caption text-tone-blocked">
                              {t(found.repo)}
                            </p>
                          )}
                          {found.days && (
                            <p id={daysError} role="alert" className="text-caption text-tone-blocked">
                              {t(found.days)}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {suggestions.length > 0 && (
            <datalist id={listId}>
              {suggestions.map((repo) => (
                <option key={repo} value={repo} />
              ))}
            </datalist>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!textMode && (
          <Button ref={addButton} size="sm" icon={Plus} onClick={addRow}>
            {t("settings.addRepository")}
          </Button>
        )}
        {/* One toggle with a fixed name rather than a button that renames itself: the pressed state says which view is open. */}
        <Button key="edit-as-text" size="sm" variant="ghost" icon={FileText} aria-pressed={textMode} className={cx(textMode && "bg-bg-muted text-fg")} onClick={toggle}>
          {t("settings.editAsText")}
        </Button>
      </div>
    </div>
  );
}
