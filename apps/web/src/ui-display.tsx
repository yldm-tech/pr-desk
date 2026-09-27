import { HTTPError, NetworkError, TimeoutError } from "ky";
import { CircleAlert, CircleCheck, Info, LoaderCircle, RefreshCw, TriangleAlert, UserRound, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { glyphIcon, toneBorder, toneText, type GlyphKind, type Tone } from "./tone";
import { apiURL } from "./api-url";
import { Button, buttonClass, cx, IconButton } from "./ui-controls";

export type { Tone, GlyphKind } from "./tone";

// The row's state at a glance: a 20px box holding the tone's glyph, an accent dot when there is something unread, and a spinner while an action on the row is in flight. `label` makes it an image with a name; without one it is decoration, because the row says the same thing in words.
export function StateGlyph({ tone, kind, label, unread = false, busy = false, className }: { tone: Tone; kind: GlyphKind; label?: string; unread?: boolean; busy?: boolean; className?: string }) {
  const Icon = busy ? LoaderCircle : glyphIcon[kind];
  const muted = kind === "merged" || kind === "closed";
  return (
    <span data-glyph={kind} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx("relative inline-grid size-5 shrink-0 place-items-center", muted ? "text-fg-muted" : toneText[tone], className)}>
      <Icon size={16} strokeWidth={2} aria-hidden="true" className={busy ? "animate-spin" : undefined} />
      {unread && <span className="absolute -top-px -right-px size-1.5 rounded-full bg-accent ring-2 ring-bg" />}
    </span>
  );
}

const chipBase = "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-sm border bg-transparent px-1.5 text-caption font-medium whitespace-nowrap no-underline";

// One fact in the tone that explains it. The border is the tone at 32%, the text the tone itself, and the background transparent, so a chip reads the same on any surface. A chip with `href` or `to` is a link.
export function FactChip({ tone, icon: Icon, children, title, href, to, className }: { tone: Tone; icon?: LucideIcon; children: ReactNode; title?: string; href?: string; to?: string; className?: string }) {
  const classes = cx(chipBase, toneText[tone], toneBorder[tone], (href || to) && "hover:bg-bg-muted", className);
  const content = (
    <>
      {Icon && <Icon size={12} strokeWidth={2.25} aria-hidden="true" className="shrink-0" />}
      <span className="truncate">{children}</span>
    </>
  );
  if (to !== undefined)
    return (
      <Link to={to} data-tone={tone} title={title} className={classes}>
        {content}
      </Link>
    );
  if (href !== undefined)
    return (
      <a href={href} data-tone={tone} title={title} className={classes}>
        {content}
      </a>
    );
  return (
    <span data-tone={tone} title={title} className={classes}>
      {content}
    </span>
  );
}

// An applied filter the reader can see and remove. The clear button is a 44px target on a coarse pointer; the negative margin keeps the chip compact while the button reaches that size.
export function FilterChip({ label, clearLabel, onClear, testId }: { label: string; clearLabel: string; onClear: () => void; testId: string }) {
  return (
    <span data-testid={testId} className="inline-flex h-7 max-w-full min-w-0 items-center gap-0.5 rounded-full border border-line-strong bg-surface pr-0.5 pl-2.5 text-small text-fg">
      <span className="truncate">{label}</span>
      <button type="button" aria-label={clearLabel} title={clearLabel} onClick={onClear} className="inline-grid size-6 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-fg-muted hover:bg-bg-muted hover:text-fg pointer-coarse:-my-2 pointer-coarse:size-11">
        <X size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent"; className?: string }) {
  return <span className={cx("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-caption font-medium tabular-nums", tone === "accent" ? "bg-accent-subtle text-accent-text" : "bg-bg-muted text-fg-muted", className)}>{children}</span>;
}

const avatarSize = { 20: "size-5", 24: "size-6", 32: "size-8" } as const;

// GitHub's own avatar URL, which the API's img-src allows. A failed load (offline, a deleted account) falls back to a person glyph rather than a broken image.
export function Avatar({ login, size, alt = "" }: { login: string; size: 20 | 24 | 32; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!login || failed)
    return (
      <span role={alt ? "img" : undefined} aria-label={alt || undefined} className={cx("inline-grid shrink-0 place-items-center rounded-full bg-bg-muted text-fg-muted", avatarSize[size])}>
        <UserRound size={Math.round(size * 0.6)} aria-hidden="true" />
      </span>
    );
  return <img className={cx("shrink-0 rounded-full bg-bg-muted object-cover", avatarSize[size])} src={`https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}`} width={size} height={size} alt={alt} onError={() => setFailed(true)} />;
}

const DAY = 86_400_000;

const ageParts = (value: Date, now: Date) => {
  const elapsed = Math.max(0, now.getTime() - value.getTime());
  return elapsed >= DAY ? ([Math.floor(elapsed / DAY), "day"] as const) : elapsed >= 3_600_000 ? ([Math.floor(elapsed / 3_600_000), "hour"] as const) : ([Math.max(1, Math.floor(elapsed / 60_000)), "minute"] as const);
};

// Intl's narrow unit is a Latin letter in Japanese and Spanish ("26d"), so those two take the short style instead, which is their own abbreviation ("26日", "26 d"); Japanese drops the space Intl puts before the unit. Every other language's narrow form is already its own ("26天", "26일", "26d").
const shortAge = new Set(["ja", "es"]);

// A compact age in the active language: "26d", "26日", "26天", or hours and minutes under a day. It is for the eye; screen readers get formatAgeLong beside it.
export function formatAge(value: Date, now: Date, language: string | undefined) {
  const [amount, unit] = ageParts(value, now);
  const base = (language ?? "en").split("-")[0];
  const text = new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: shortAge.has(base) ? "short" : "narrow" }).format(amount);
  return base === "ja" ? text.replace(/\s+/g, "") : text;
}

// The same age as a phrase ("26 days ago"), which is what a screen reader should say instead of the compact form's letters.
export function formatAgeLong(value: Date, now: Date, language: string | undefined) {
  const [amount, unit] = ageParts(value, now);
  return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-amount, unit);
}

export function formatDate(value: Date, language: string | undefined, now = new Date()) {
  const options: Intl.DateTimeFormatOptions = value.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(language, options).format(value);
}

export function formatDateTime(value: Date, language: string | undefined) {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

// A <time> with a machine-readable value and, as its tooltip, the full date and time. Formatting goes through Intl in the language the reader picked, never the browser's.
export function Time({ value, mode, title, className }: { value: string | Date; mode: "age" | "date" | "datetime"; title?: string; className?: string }) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  if (mode === "age")
    return (
      <time dateTime={date.toISOString()} title={title ?? formatDateTime(date, language)} className={cx("tabular-nums", className)}>
        <span aria-hidden="true">{formatAge(date, new Date(), language)}</span>
        <span className="sr-only">{formatAgeLong(date, new Date(), language)}</span>
      </time>
    );
  return (
    <time dateTime={date.toISOString()} title={title ?? formatDateTime(date, language)} className={cx("tabular-nums", className)}>
      {mode === "date" ? formatDate(date, language) : formatDateTime(date, language)}
    </time>
  );
}

export function Stat({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div className={cx("grid min-w-0 gap-0.5", className)}>
      <span className="text-display font-semibold text-fg tabular-nums">{value}</span>
      <span data-stat-label="" className="text-small text-fg-muted">
        {label}
      </span>
    </div>
  );
}

export type BarRow = { key: string; label: ReactNode; value: number; share: number; href?: string };

// A ranked list as a real table, so every value is read with its row and column. The bar is decoration: the number and the share next to it carry the data. `share` is 0..1; `href` is a route inside the app.
export function BarList({ id, caption, columns, rows, className }: { id?: string; caption: string; columns: [string, string, string]; rows: BarRow[]; className?: string }) {
  const { i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  return (
    <table id={id} className={cx("w-full border-collapse text-body", className)}>
      <caption className="pb-2 text-left text-body font-semibold text-fg">{caption}</caption>
      <thead className="sr-only">
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-line first:border-t-0">
            <th scope="row" className="w-full max-w-0 py-2 pr-3 text-left font-normal">
              <div className="grid min-w-0 gap-1.5">
                <span className="min-w-0 truncate">
                  {row.href ? (
                    <Link to={row.href} className="text-fg no-underline hover:underline">
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                </span>
                <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-bg-muted">
                  <span className="block h-full rounded-full bg-chart-bar" style={{ width: `${Math.max(0, Math.min(1, row.share)) * 100}%` }} />
                </span>
              </div>
            </th>
            <td className="py-2 pr-3 text-right align-top font-medium whitespace-nowrap text-fg tabular-nums">{number.format(row.value)}</td>
            <td className="py-2 text-right align-top whitespace-nowrap text-fg-subtle tabular-nums">{percent.format(row.share)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type NoticeTone = "info" | "warning" | "danger" | "success";
const noticeStyle: Record<NoticeTone, { box: string; icon: string; glyph: LucideIcon }> = {
  info: { box: "bg-info-soft border-accent-line", icon: "text-accent-text", glyph: Info },
  warning: { box: "bg-tone-action-soft border-tone-action-line", icon: "text-tone-action", glyph: TriangleAlert },
  danger: { box: "bg-tone-blocked-soft border-tone-blocked-line", icon: "text-tone-blocked", glyph: CircleAlert },
  success: { box: "bg-tone-ready-soft border-tone-ready-line", icon: "text-tone-ready", glyph: CircleCheck },
};

// A message about the page rather than about one item. The text stays in the normal ink on every tone; only the glyph and the border carry the colour. `role` is the caller's call: "alert" for something that just went wrong, "status" for something the reader should hear without being interrupted, nothing for a standing note.
export function Notice({ tone, title, children, actions, onDismiss, dismissLabel, role, className }: { tone: NoticeTone; title?: string; children?: ReactNode; actions?: ReactNode; onDismiss?: () => void; dismissLabel?: string; role?: "alert" | "status"; className?: string }) {
  const style = noticeStyle[tone];
  const Glyph = style.glyph;
  return (
    <div role={role} className={cx("flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-body text-fg", style.box, className)}>
      <Glyph size={16} aria-hidden="true" className={cx("mt-0.5 shrink-0", style.icon)} />
      <div className="grid min-w-0 flex-1 gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>}
        {actions && <div className="mt-1 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {onDismiss && dismissLabel && <IconButton label={dismissLabel} icon={X} size="sm" onClick={onDismiss} className="-my-1 -mr-1" />}
    </div>
  );
}

// The last good data is still on screen but the latest refresh failed. Said once, above the content, with the way to try again.
export function StaleNotice({ at, onRetry, className }: { at?: string; onRetry: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <Notice
      tone="warning"
      role="status"
      className={className}
      actions={
        <Button size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      }
    >
      {t("refreshFailedKeepData")}
      {at && (
        <>
          {" "}
          <Time value={at} mode="datetime" className="text-fg-muted" />
        </>
      )}
    </Notice>
  );
}

const emptyTone: Record<Tone | "success", string> = { ...toneText, success: "text-tone-ready" };

export function EmptyState({ icon: Icon, tone, title, description, action, secondary, className }: { icon?: LucideIcon; tone?: Tone | "success"; title: string; description?: string; action?: ReactNode; secondary?: ReactNode; className?: string }) {
  const Glyph = Icon ?? (tone === "success" ? CircleCheck : undefined);
  return (
    <div className={cx("mx-auto grid max-w-md justify-items-center gap-2 px-4 py-12 text-center", className)}>
      {Glyph && (
        <span aria-hidden="true" className={cx("mb-1 inline-grid size-10 place-items-center rounded-full bg-bg-muted", tone ? emptyTone[tone] : "text-fg-muted")}>
          <Glyph size={20} />
        </span>
      )}
      <p className="text-title font-semibold text-fg">{title}</p>
      {description && <p className="text-body text-fg-muted">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
      {secondary && <div className="text-small">{secondary}</div>}
    </div>
  );
}

// What kind of failure a request ended in, which is what decides the sentence under an error: a 401 is a session to reconnect, any other 4xx or a 5xx is the server's, and a request that never got an answer is the network's. Null when there is nothing more useful to say than the title.
export function errorKind(error: unknown): "auth" | "server" | "offline" | null {
  if (error instanceof HTTPError) return error.response.status === 401 ? "auth" : "server";
  if (error instanceof TimeoutError || error instanceof NetworkError || error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) return "offline";
  return null;
}

// The one failure state every page uses in its content region, in the same place and alignment as EmptyState: what could not be loaded (the title), why in words chosen by the kind of failure, the retry, and for an ended session the way to reconnect. `actions` are the page's own extra ways out, after the retry.
export function ErrorState({ title, error, description, onRetry, actions, className }: { title: string; error?: unknown; description?: string; onRetry: () => void; actions?: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const kind = errorKind(error);
  const said = description ?? (kind === "auth" ? t("shell.errorAuth") : kind === "offline" ? t("shell.errorOffline") : kind === "server" ? t("shell.errorServer") : undefined);
  return (
    <div role="alert" className={cx("mx-auto grid max-w-md justify-items-center gap-2 px-4 py-12 text-center", className)}>
      <span aria-hidden="true" className="mb-1 inline-grid size-10 place-items-center rounded-full bg-tone-blocked-soft text-tone-blocked">
        <CircleAlert size={20} />
      </span>
      <p className="text-title font-semibold text-fg">{title}</p>
      {said && <p className="text-body text-fg-muted">{said}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button icon={RefreshCw} onClick={onRetry}>
          {t("retry")}
        </Button>
        {kind === "auth" && (
          <a href={apiURL + "/api/v1/auth/github"} className={buttonClass("ghost")}>
            {t("followup.reconnect")}
          </a>
        )}
        {actions}
      </div>
    </div>
  );
}

// Every page opens with this frame: an optional caption above the h1 (the Inbox date), the h1 with its count, the page's own actions, and a summary slot below. The count sits beside the heading rather than inside it, so the heading's accessible name stays the page name.
export function PageHeader({ title, count, caption, captionClassName, actions, summary, className }: { title: string; count?: number; caption?: string; captionClassName?: string; actions?: ReactNode; summary?: ReactNode; className?: string }) {
  const { i18n } = useTranslation();
  return (
    <header className={cx("grid min-w-0 gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {caption && <p className={cx("mb-0.5 text-caption font-medium tracking-[var(--caption-tracking)] text-fg-subtle [text-transform:var(--caption-transform)]", captionClassName)}>{caption}</p>}
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="min-w-0 text-page font-semibold tracking-[var(--tracking-page)] text-fg [overflow-wrap:anywhere]">{title}</h1>
            {count !== undefined && <span className="text-title font-medium text-fg-subtle tabular-nums">{new Intl.NumberFormat(i18n.resolvedLanguage).format(count)}</span>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {summary}
    </header>
  );
}

// The row of filters and search under a page header. `sticky` keeps it in reach on a long list; below the shell breakpoint it parks under the sticky top bar instead of behind it.
export function Toolbar({ children, sticky = false, className }: { children: ReactNode; sticky?: boolean; className?: string }) {
  return <div className={cx("flex min-w-0 flex-wrap items-center gap-2", sticky && "sticky top-[var(--topbar-h)] z-10 -mx-1 bg-bg px-1 py-2 shell:top-0", className)}>{children}</div>;
}
