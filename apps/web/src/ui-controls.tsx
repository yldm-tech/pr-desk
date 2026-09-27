import * as RadixTabs from "@radix-ui/react-tabs";
import { ArrowUpRight, LoaderCircle, Search, X, type LucideIcon } from "lucide-react";
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toneText, type Tone } from "./tone";

// Joins class fragments, dropping the empty ones, so a conditional class can be written inline.
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

// Labels never truncate: a label longer than its row wraps inside the button rather than being cut, and clusters are flex-wrap so whole buttons move to the next line first. The height is a floor, not a fixed value, for that reason. Every control reaches 44px on a coarse pointer.
const buttonBase = "relative inline-flex max-w-full items-center justify-center gap-1.5 rounded-md border text-center font-medium no-underline transition-colors duration-[var(--dur-fast)] ease-out select-none pointer-coarse:min-h-11 pointer-coarse:min-w-11";
// Written as a function rather than a keyed map: lint:responsive refuses the names of the cleared Tailwind breakpoints followed by a colon anywhere in the source, object keys included.
const buttonSize = (size: Size) => (size === "sm" ? "min-h-7 px-2.5 py-0.5 text-small" : "min-h-8 px-3 py-1 text-body");
const buttonVariant: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border-line-strong bg-surface text-fg hover:bg-bg-subtle",
  ghost: "border-transparent bg-transparent text-fg-muted hover:bg-bg-muted hover:text-fg",
  danger: "border-transparent bg-transparent text-tone-blocked hover:bg-tone-blocked-soft",
};
const iconSize = (size: Size) => (size === "sm" ? 14 : 16);

export function buttonClass(variant: ButtonVariant = "secondary", size: Size = "md") {
  return cx(buttonBase, buttonSize(size), buttonVariant[variant]);
}

function Spinner({ size }: { size: number }) {
  return <LoaderCircle size={size} aria-hidden="true" className="shrink-0 animate-spin" />;
}

export function Button({ variant = "secondary", size = "md", icon: Icon, busy = false, className, children, disabled, type = "button", ref, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: Size; icon?: LucideIcon; busy?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const glyph = iconSize(size);
  return (
    <button ref={ref} type={type} className={cx(buttonClass(variant, size), className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {/* The spinner takes the icon's place, so the width does not move; a button with no icon keeps its label in the layout (invisible) and centres the spinner over it. */}
      {Icon && (busy ? <Spinner size={glyph} /> : <Icon size={glyph} aria-hidden="true" className="shrink-0" />)}
      {!Icon && busy ? (
        <>
          <span className="invisible">{children}</span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner size={glyph} />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

// An icon with no visible text. The label is the accessible name and, for a mouse, the tooltip.
export function IconButton({ label, icon: Icon, size = "md", tone, className, type = "button", busy = false, disabled, ref, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; size?: Size; tone?: Tone; busy?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx("inline-grid shrink-0 place-items-center rounded-md border border-transparent bg-transparent p-0 transition-colors duration-[var(--dur-fast)] hover:bg-bg-muted pointer-coarse:size-11", size === "sm" ? "size-7" : "size-8", tone ? toneText[tone] : "text-fg-muted hover:text-fg", className)}
      {...props}
    >
      {busy ? <Spinner size={16} /> : <Icon size={16} aria-hidden="true" />}
    </button>
  );
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to?: string; href?: string; external?: boolean; newTabLabel?: string; ref?: Ref<HTMLAnchorElement> };

// One anchor for both kinds of destination: `to` is a route inside the app (HashRouter), `href` a real URL. `external` opens a new tab and says so, visibly with an arrow and to assistive technology with `newTabLabel`, which the caller translates ("opens in a new tab").
function Anchor({ to, href, external, newTabLabel, children, ref, ...props }: AnchorProps & { children: ReactNode }) {
  const tab = external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const content = (
    <>
      {children}
      {external && newTabLabel && <span className="sr-only"> ({newTabLabel})</span>}
    </>
  );
  if (to !== undefined)
    return (
      <Link ref={ref} to={to} {...tab} {...props}>
        {content}
      </Link>
    );
  return (
    <a ref={ref} href={href} {...tab} {...props}>
      {content}
    </a>
  );
}

export function LinkButton({ variant = "secondary", size = "md", icon: Icon, className, children, external, ...props }: AnchorProps & { variant?: ButtonVariant; size?: Size; icon?: LucideIcon; children: ReactNode }) {
  const glyph = iconSize(size);
  return (
    <Anchor external={external} className={cx(buttonClass(variant, size), className)} {...props}>
      {Icon && <Icon size={glyph} aria-hidden="true" className="shrink-0" />}
      {children}
      {external && <ArrowUpRight size={glyph - 2} aria-hidden="true" className="shrink-0 opacity-70" />}
    </Anchor>
  );
}

const textLinkTone = { default: "text-accent-text", muted: "text-fg-muted hover:text-fg" } as const;

// A link that reads as text. Underlined on hover only when it stands alone; `inline` (a link inside a sentence) is always underlined, because inside running text the colour alone is not enough to find it.
export function TextLink({ tone = "default", inline = false, externalIcon = true, className, children, external, ...props }: AnchorProps & { tone?: "default" | "muted"; inline?: boolean; externalIcon?: boolean; children: ReactNode }) {
  return (
    <Anchor external={external} className={cx("rounded-sm decoration-1 underline-offset-2 hover:underline", inline ? "underline decoration-current/40" : "no-underline", textLinkTone[tone], className)} {...props}>
      {children}
      {external && externalIcon && <ArrowUpRight size={12} aria-hidden="true" className="ml-0.5 inline-block align-[-1px] opacity-70" />}
    </Anchor>
  );
}

// Whether a horizontal strip has more content past its edges, kept current as it scrolls and resizes, and a one-time scroll that brings `selected` into view. Only the strip is scrolled, never the page: scrollIntoView would also move the document to bring the strip itself into view, which on a phone shifts the list under the reader the moment the page mounts.
// Bring an item wholly inside the strip, with a little room past it. Chromium's own scroll on keyboard focus stops once part of the item shows, which leaves a focused pill half under the next control.
function revealInStrip(element: HTMLElement, item: HTMLElement) {
  const pill = item.getBoundingClientRect();
  const track = element.getBoundingClientRect();
  if (pill.left < track.left) element.scrollLeft -= track.left - pill.left + 8;
  else if (pill.right > track.right) element.scrollLeft += pill.right - track.right + 8;
}

function useScrollStrip(selected: string | undefined) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<"none" | "start" | "end" | "both">("none");
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const focused = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== element) revealInStrip(element, event.target);
    };
    element.addEventListener("focusin", focused);
    const measure = () => {
      const before = element.scrollLeft > 1;
      const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges(before && after ? "both" : before ? "start" : after ? "end" : "none");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
      element.removeEventListener("focusin", focused);
    };
  }, []);
  useLayoutEffect(() => {
    const element = strip.current;
    const item = element?.querySelector<HTMLElement>("[aria-pressed=true],[aria-selected=true]");
    if (element && item) revealInStrip(element, item);
  }, [selected]);
  return { strip, edges };
}

// The fade that says a strip continues past an edge. A mask rather than an overlay, so it fades whatever the strip sits on in either theme; the mask only reads alpha.
const stripFade = "data-[edges=end]:[mask-image:linear-gradient(to_right,black_85%,transparent)] data-[edges=start]:[mask-image:linear-gradient(to_left,black_85%,transparent)] data-[edges=both]:[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]";
// One line whatever the width: a strip too wide for its row scrolls sideways, with no scrollbar drawn over the pill, instead of wrapping into a taller shape. No scroll snapping: a snap point pulls a focused item at the end of the strip back out of view.
const stripScroll = "flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export type SegmentItem<T extends string> = { value: T; label: string; count?: number | string; testId?: string };

// A set of mutually exclusive filters that each change the view, not a tab set: pressed toggle buttons (aria-pressed) in a group, so each keeps its own name and the tests and screen readers can address it directly. The track stays one pill high: when it does not fit it scrolls sideways, fades at the edge that has more, and brings the pressed item into view.
export function SegmentedControl<T extends string>({ label, value, onChange, items, size = "md", className }: { label: string; value: T; onChange: (value: T) => void; items: SegmentItem<T>[]; size?: Size; className?: string }) {
  const { strip, edges } = useScrollStrip(value);
  return (
    <div ref={strip} role="group" aria-label={label} data-edges={edges} className={cx("inline-flex max-w-full gap-0.5 rounded-2xl bg-bg-muted p-0.5 pointer-coarse:rounded-3xl", stripScroll, stripFade, className)}>
      {items.map((item) => {
        const pressed = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed}
            data-testid={item.testId}
            onClick={() => onChange(item.value)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border-0 font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-[var(--dur-fast)] ease-out pointer-coarse:min-h-11 pointer-coarse:px-4",
              size === "md" ? "min-h-7 px-3 text-body" : "min-h-6 px-2.5 text-small",
              pressed ? "bg-surface text-fg shadow-1" : "bg-transparent text-fg-muted hover:text-fg",
            )}
          >
            {item.label}
            {item.count !== undefined && <span className={cx("text-caption tabular-nums", pressed ? "text-fg-muted" : "text-fg-subtle")}>{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// The tab list, on the same one-line scrolling strip as SegmentedControl, so a narrow screen scrolls the tabs rather than stranding the last one on a second line under the underline. The rule under the tabs is an inset shadow rather than a border: a scroller clips what overhangs it, so the active tab's underline has to sit inside the list's box, over the rule, instead of hanging 1px below it.
function TabStrip({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const { strip, edges } = useScrollStrip(value);
  return (
    <RadixTabs.List ref={strip} aria-label={label} data-edges={edges} className={cx("flex gap-x-4 shadow-[inset_0_-1px_0_var(--line)]", stripScroll, stripFade)}>
      {children}
    </RadixTabs.List>
  );
}

// Radix tabs with an underline. A panel mounts on its first visit and then stays mounted and hidden, so a half-filled form survives a trip to another tab.
export function Tabs({ value, onValueChange, label, items, children, className, panelClassName }: { value: string; onValueChange: (value: string) => void; label: string; items: { value: string; label: string }[]; children: (value: string) => ReactNode; className?: string; panelClassName?: string }) {
  const [visited, setVisited] = useState(() => new Set([value]));
  useEffect(() => {
    setVisited((previous) => (previous.has(value) ? previous : new Set(previous).add(value)));
  }, [value]);
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <TabStrip label={label} value={value}>
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="inline-flex min-h-9 shrink-0 items-center border-0 whitespace-nowrap border-b-2 border-solid border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted transition-colors duration-[var(--dur-fast)] hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </TabStrip>
      {items.map(
        (item) =>
          (visited.has(item.value) || item.value === value) && (
            <RadixTabs.Content key={item.value} value={item.value} forceMount hidden={item.value !== value} className={cx("mt-4 focus-visible:outline-offset-4", panelClassName)}>
              {children(item.value)}
            </RadixTabs.Content>
          ),
      )}
    </RadixTabs.Root>
  );
}

const controlBase = "rounded-md border border-line-strong bg-surface text-body text-fg transition-colors duration-[var(--dur-fast)] placeholder:text-fg-subtle hover:border-fg-subtle aria-invalid:border-tone-blocked disabled:opacity-50 pointer-coarse:text-[length:1rem]";

// A native select: it is what the platform does best on every pointer, and tests drive it with selectOption. `hideLabel: "below-pair"` keeps the label for a toolbar that has room and hands it to assistive technology only when the content box is narrow.
export function Select({ label, hideLabel = false, options, className, id, ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean | "below-pair"; options: { value: string; label: string }[]; ref?: Ref<HTMLSelectElement> }) {
  const fallback = useId();
  const selectId = id ?? fallback;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2", className)}>
      <label htmlFor={selectId} className={cx("shrink-0 text-small font-medium text-fg-muted", hideLabel === true && "sr-only", hideLabel === "below-pair" && "@max-pair/dashboard:sr-only")}>
        {label}
      </label>
      <select ref={ref} id={selectId} className={cx(controlBase, "min-h-8 min-w-0 cursor-pointer appearance-none bg-[image:var(--icon-chevron)] bg-[length:14px] bg-[position:right_0.5rem_center] bg-no-repeat py-1 pr-8 pl-2.5 pointer-coarse:min-h-11")} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

// Label, control, help and error in one place. The control is the single child; Field gives it the description and invalid state so they cannot drift from the text on screen.
export function Field({ label, help, error, htmlFor, layout = "stacked", children, className }: { label: ReactNode; help?: ReactNode; error?: ReactNode; htmlFor: string; layout?: "stacked" | "inline"; children: ReactNode; className?: string }) {
  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>(children) ? cloneElement(children as ReactElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>, { "aria-describedby": describedBy, "aria-invalid": error ? true : undefined }) : children;
  return (
    <div className={cx("grid min-w-0 gap-1.5", layout === "inline" && "@pair/dashboard:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] @pair/dashboard:items-start @pair/dashboard:gap-x-6", className)}>
      <label htmlFor={htmlFor} className={cx("text-small font-medium text-fg", layout === "inline" && "@pair/dashboard:pt-1.5")}>
        {label}
      </label>
      <div className="grid min-w-0 gap-1.5">
        {control}
        {error && (
          <p id={errorId} role="alert" className="text-caption text-tone-blocked">
            {error}
          </p>
        )}
        {help && (
          <p id={helpId} className="text-caption text-fg-muted">
            {help}
          </p>
        )}
      </div>
    </div>
  );
}

export function TextField({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(controlBase, "min-h-8 w-full min-w-0 px-2.5 py-1 pointer-coarse:min-h-11", className)} {...props} />;
}

export function Textarea({ className, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cx(controlBase, "w-full min-w-0 px-2.5 py-2 font-mono text-small leading-relaxed", className)} {...props} />;
}

// The label is part of the target, so the whole row is 44px tall on a coarse pointer, not just the box.
export function Checkbox({ label, description, className, ref, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  return (
    <label className={cx("inline-flex min-h-8 cursor-pointer items-start gap-2 py-1 text-body text-fg pointer-coarse:min-h-11 pointer-coarse:items-center", className)}>
      <input ref={ref} type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)] pointer-coarse:mt-0" {...props} />
      <span className="min-w-0">
        {label}
        {description && <span className="block text-caption text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}

// Search in one box: the field, a clear button, and in `submit` mode Enter commits. `live` reports every keystroke (a local filter); `submit` keeps a draft and reports it on Enter (a server query), and clearing commits the empty value at once. id="pr-search" is what the `/` shortcut focuses.
export function SearchField({
  id,
  label,
  value,
  onChange,
  onSubmit,
  mode,
  placeholder,
  maxLength,
  kbdHint = false,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  mode: "live" | "submit";
  placeholder?: string;
  maxLength?: number;
  kbdHint?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const fallback = useId();
  const inputId = id ?? fallback;
  const [draft, setDraft] = useState(value);
  // In live mode the field shows its own draft and reports every keystroke. The value it gets back usually lags behind (a URL-backed value arrives a render or more later), so an echo of something this field already reported must not overwrite what has been typed since; only a value it never sent, such as a filter reset elsewhere on the page, replaces the draft.
  const sent = useRef<string[]>([]);
  useEffect(() => {
    const echo = sent.current.indexOf(value);
    if (echo >= 0) sent.current = sent.current.slice(echo + 1);
    else {
      sent.current = [];
      setDraft(value);
    }
  }, [value]);
  const text = draft;
  const report = (next: string) => {
    if (mode === "live") sent.current.push(next);
    onChange(next);
  };
  const update = (next: string) => {
    setDraft(next);
    if (mode === "live") report(next);
  };
  const clear = () => {
    setDraft("");
    report("");
    if (mode === "submit") onSubmit?.("");
    document.getElementById(inputId)?.focus();
  };
  return (
    <form
      role="search"
      className={cx("relative flex min-w-0 items-center", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (mode === "submit") {
          onChange(draft.trim());
          onSubmit?.(draft.trim());
        }
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-fg-subtle" />
      <input
        id={inputId}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
        className={cx(controlBase, "min-h-8 w-full min-w-0 py-1 pr-9 pl-8 pointer-coarse:min-h-11 pointer-coarse:pr-12 [&::-webkit-search-cancel-button]:appearance-none")}
      />
      {text ? (
        <button type="button" aria-label={t("clear")} title={t("clear")} onClick={clear} className="absolute right-0.5 inline-grid size-7 place-items-center rounded-md border-0 bg-transparent p-0 text-fg-muted hover:bg-bg-muted hover:text-fg pointer-coarse:size-11">
          <X size={14} aria-hidden="true" />
        </button>
      ) : (
        kbdHint && (
          <span aria-hidden="true" className="pointer-events-none absolute right-2 pointer-coarse:hidden">
            <Kbd>/</Kbd>
          </span>
        )
      )}
    </form>
  );
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line bg-bg-subtle px-1 font-mono text-caption text-fg-muted">{children}</kbd>;
}
