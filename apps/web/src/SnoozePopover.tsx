import * as RadixPopover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import ky from "ky";
import { Clock } from "lucide-react";
import { useCallback, useId, useState, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { apiURL } from "./api-url";
import { snoozeBounds, snoozePresets } from "./followup-view";
import { Button, buttonClass, cx } from "./ui-controls";

// The reminder schedule, read through the same query key, request and schema the Settings page uses, so the two share one cache entry and a save on either side refreshes the other. The Inbox only reads it: the digest time and timezone place "Tomorrow morning", and the waiting periods say when a waiting row becomes overdue. Until it has loaded both simply fall back (09:00 local; no overdue hint), which is why a failure here is silent.
const settingsSchema = z.object({ timezone: z.string(), digest_time: z.string(), wait_days: z.number(), language: z.enum(["en", "zh-CN"]).default("en"), teams: z.array(z.string()).nullable(), repository_days: z.record(z.string(), z.number()).nullable() });
export type ReminderSettings = z.infer<typeof settingsSchema>;

export function useReminderSettings(enabled = true) {
  return useQuery({
    queryKey: ["follow-up-settings"],
    enabled,
    queryFn: ({ signal }) =>
      ky
        .get(apiURL + "/api/v1/follow-up-settings", { credentials: "include", signal, retry: 0 })
        .json()
        .then((data) => settingsSchema.parse(data)),
    retry: false,
  });
}

const presetKeys = { "3": "3d", "7": "7d", t: "tomorrow" } as const;

// "Remind me later" as a menu of three one-tap presets and a custom date. The trigger is a real button with aria-expanded (Radix), and every choice is a button whose name starts with its preset ("3 days · Wed, Sep 30"), so the day the row will come back is known before it is chosen. Inside a modal sheet the menu is portalled into that <dialog>: anything outside a modal dialog is inert, so a menu portalled to <body> could be seen and never clicked.
export function SnoozePopover({
  label,
  compact = false,
  disabled = false,
  open,
  onOpenChange,
  settings,
  onSnooze,
  triggerClassName,
  ref,
}: {
  // The trigger's accessible name, which starts with the visible "Remind me later" ("Remind me later — fixture/calendar #17").
  label: string;
  // Icon only, with the name as its tooltip: the split view's rail has room for four icons and not for a sentence.
  compact?: boolean;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings?: { timezone: string; digest_time: string };
  onSnooze: (until: Date) => void;
  triggerClassName?: string;
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  const { t, i18n } = useTranslation();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // Stable, so React attaches it once rather than detaching and re-attaching it on every render.
  const attach = useCallback(
    (element: HTMLButtonElement | null) => {
      if (ref) ref.current = element;
      if (element) setContainer(element.closest("dialog"));
    },
    [ref],
  );
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState("");
  const [rangeHint, setRangeHint] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const now = new Date();
  const bounds = snoozeBounds(now.getTime());
  const presets = snoozePresets(now, settings);
  const language = i18n.resolvedLanguage;
  const dayFormat = new Intl.DateTimeFormat(language, { weekday: "short", month: "short", day: "numeric" });
  const timeFormat = new Intl.DateTimeFormat(language, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const presetLabel = (key: "3d" | "7d" | "tomorrow") => (key === "3d" ? t("followup.days", { count: 3 }) : key === "7d" ? t("followup.days", { count: 7 }) : t("inbox.tomorrowMorning"));
  const outOfRange = !date || date < bounds.min || date > bounds.max;
  const reset = () => {
    setCustom(false);
    setDate("");
    setRangeHint(false);
  };
  const change = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  const pick = (until: Date) => onSnooze(until);
  const confirmCustom = () => (outOfRange ? setRangeHint(true) : pick(new Date(date)));
  // 3, 7, t and c pick without reaching for the pointer once the menu is open; they are ignored while the date field has focus, where they are text.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest("input")) return;
    const key = event.key.toLowerCase();
    if (key in presetKeys) {
      const preset = presets.find((entry) => entry.key === presetKeys[key as keyof typeof presetKeys]);
      if (preset) {
        event.preventDefault();
        pick(preset.until);
      }
    } else if (key === "c") {
      event.preventDefault();
      setCustom(true);
    }
  };
  const trigger = compact ? (
    <button
      ref={attach}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cx("inline-grid size-7 shrink-0 place-items-center rounded-md border border-transparent bg-transparent p-0 text-fg-muted transition-colors duration-[var(--dur-fast)] hover:bg-bg-muted hover:text-fg data-[state=open]:bg-bg-muted data-[state=open]:text-fg pointer-coarse:size-11", triggerClassName)}
    >
      <Clock size={16} aria-hidden="true" />
    </button>
  ) : (
    <button ref={attach} type="button" aria-label={label} disabled={disabled} className={cx(buttonClass("ghost", "sm"), "data-[state=open]:bg-bg-muted data-[state=open]:text-fg", triggerClassName)}>
      <Clock size={14} aria-hidden="true" className="shrink-0" />
      {t("followup.snooze")}
    </button>
  );
  return (
    <RadixPopover.Root open={open} onOpenChange={change}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal container={container ?? undefined}>
        <RadixPopover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          aria-label={t("followup.snooze")}
          onKeyDown={onKeyDown}
          className="z-50 grid max-h-[var(--radix-popover-content-available-height)] w-[min(288px,calc(100vw-32px))] gap-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 text-body text-fg shadow-1 outline-none animate-pop"
        >
          {presets.map((preset) => (
            <button key={preset.key} type="button" onClick={() => pick(preset.until)} className="flex min-h-8 w-full items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 py-1 text-left text-body text-fg hover:bg-bg-muted focus-visible:bg-bg-muted pointer-coarse:min-h-11">
              <span>{t("inbox.presetLabel", { label: presetLabel(preset.key), date: (preset.key === "tomorrow" ? timeFormat : dayFormat).format(preset.until) })}</span>
              <kbd aria-hidden="true" className="font-mono text-caption text-fg-subtle pointer-coarse:hidden">
                {preset.key === "3d" ? "3" : preset.key === "7d" ? "7" : "t"}
              </kbd>
            </button>
          ))}
          {custom ? (
            <div className="mt-1 grid gap-2 border-t border-line px-1 pt-2 pb-1">
              <label htmlFor={inputId} className="text-small font-medium text-fg-muted">
                {t("followup.custom")}
              </label>
              {/* The bounds are the server's own, so the platform picker cannot offer a value that comes back as a save error. */}
              <input
                id={inputId}
                type="datetime-local"
                autoFocus
                min={bounds.min}
                max={bounds.max}
                value={date}
                aria-describedby={outOfRange && (rangeHint || !!date) ? hintId : undefined}
                onChange={(event) => setDate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirmCustom();
                  }
                }}
                className="min-h-8 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-body text-fg pointer-coarse:min-h-11 pointer-coarse:text-[length:1rem]"
              />
              {outOfRange && (rangeHint || !!date) && (
                <p id={hintId} role="alert" className="text-caption text-tone-blocked">
                  {t("followup.reminderRange")}
                </p>
              )}
              {/* Never disabled for range reasons: a disabled confirm drops out of the tab order and gives a keyboard user no way to find out why it refuses. */}
              <Button size="sm" variant="primary" onClick={confirmCustom} className="justify-self-start">
                {t("followup.confirmSnooze")}
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setCustom(true)} className="flex min-h-8 w-full items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 py-1 text-left text-body text-fg hover:bg-bg-muted focus-visible:bg-bg-muted pointer-coarse:min-h-11">
              <span>{t("inbox.pickDate")}</span>
              <kbd aria-hidden="true" className="font-mono text-caption text-fg-subtle pointer-coarse:hidden">
                c
              </kbd>
            </button>
          )}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
