import { ChevronRight } from "lucide-react";
import type { HTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { cx } from "./ui-controls";

// The grid of every list row, by kind. Track counts only ever grow with width, which is what the layout suite's monotonicity sweep checks: a row that loses a column while the window widens has a band in the wrong place.
// list: an Inbox row. 3 tracks at every width: glyph, body, and a trailing column that holds the age on the title's line. Below its list container's `row` width the verbs sit on a line of their own under the body; from `row` they join the trailing column under the age, so the age and the verbs share one right edge in every row.
// The split view uses the same `list` row: its form follows the width of the list pane it is in, not whether a pane sits beside it, so a pane that leaves the list under `row` stacks the verbs under the body rather than squeezing the title and meta into what is left beside them.
// table: a pull-request row. 2 tracks, then 5 from `row`, measured against <main>. The last two are fixed widths rather than `auto`, because each row is its own grid and only a fixed track lines up under its header in every row; 6rem fits the longest Activity header (Japanese アクティビティ).
// repo: a repository row. 2 tracks, then 3 from `row`, then 6 from `table`.
export const itemTracks = {
  list: "grid-cols-[20px_minmax(0,1fr)_auto]",
  table: "grid-cols-[minmax(0,1fr)_auto] @row/dashboard:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_4.5rem_6rem]",
  repo: "grid-cols-[minmax(0,1fr)_auto] @row/dashboard:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] @table/dashboard:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_5.5rem_5rem_auto]",
} as const;
export type ItemTracks = keyof typeof itemTracks;

// A list of rows, or a table of them. `table` is a div table (role=table/row/columnheader) so a row can be a grid and reflow into a card on a narrow screen; the header row is always in the accessibility tree and only becomes visible once the content box reaches `row`. Rows must be direct children, after the header, for the roles to hold. `busy` draws the thin indeterminate bar of a background refetch, named for assistive technology by `busyLabel`.
export function ItemList({
  mode,
  label,
  header,
  children,
  containerName,
  tracks = "table",
  busy = false,
  busyLabel,
  as = "div",
  className,
}: {
  mode: "list" | "table";
  label?: string;
  header?: string[];
  children: ReactNode;
  containerName?: "list";
  tracks?: "table" | "repo";
  busy?: boolean;
  busyLabel?: string;
  as?: "div" | "ul";
  className?: string;
}) {
  const bar = busy && (
    <div role="status" className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-0.5 overflow-hidden">
      <span className="sr-only">{busyLabel}</span>
      <span aria-hidden="true" className="block h-full w-2/5 animate-indeterminate bg-accent" />
    </div>
  );
  if (mode === "table")
    return (
      <div role="table" aria-label={label} className={cx("relative min-w-0", className)}>
        {bar}
        {header && (
          <div
            role="row"
            className={cx(
              "grid gap-x-3 p-0 text-small font-medium text-fg-muted",
              itemTracks[tracks],
              "absolute h-px w-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)] @row/dashboard:static @row/dashboard:h-auto @row/dashboard:w-auto @row/dashboard:overflow-visible @row/dashboard:border-b @row/dashboard:border-line @row/dashboard:px-3 @row/dashboard:py-2 @row/dashboard:whitespace-normal @row/dashboard:[clip-path:none]",
            )}
          >
            {header.map((name) => (
              <span role="columnheader" key={name} className="min-w-0 truncate">
                {name}
              </span>
            ))}
          </div>
        )}
        {children}
      </div>
    );
  const List = as;
  return (
    <List role={label && as === "div" ? "group" : undefined} aria-label={label} className={cx("relative m-0 min-w-0 list-none p-0", containerName === "list" && "@container/list", className)}>
      {bar}
      {children}
    </List>
  );
}

// The body of a row reacts to a click only where nothing else would: a click that lands on a control or a link is that control's.
const INTERACTIVE = "a, button, input, select, textarea, summary, label, [role=button], [role=link], [role=menuitem]";

type RowProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  as?: "article" | "li" | "div";
  tracks: ItemTracks;
  glyph?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  excerpt?: ReactNode;
  // The list tracks' trailing cell on the title's line: the age, which stays in the same place whatever the width and whichever row is active.
  aside?: ReactNode;
  rail?: ReactNode;
  active?: boolean;
  unread?: boolean;
  highlight?: boolean;
  exiting?: boolean;
  onBodyClick?: () => void;
  ref?: Ref<HTMLElement>;
  "data-testid"?: string;
};

// One row. For the list tracks it lays out glyph | title, meta, excerpt | rail, and moves the rail under the body when the list is narrow. For the table and repo tracks the glyph and title form the first cell and `children` supply the rest, each its own grid item (role=cell for a table).
// active is the keyboard cursor (a filled row with an inset accent bar, read by the tests as box-shadow); highlight flashes the row once, for a deep link or "Show latest"; exiting is a row on its way out, which gives up its id, test id and cursor and becomes inert so nothing can find or focus a ghost.
export function ItemRow({ as = "div", tracks, glyph, title, meta, excerpt, aside, rail, active = false, unread = false, highlight = false, exiting = false, onBodyClick, className, children, onClick, ref, ...rest }: RowProps) {
  const Tag = as;
  const attributes: Record<string, unknown> = { ...rest };
  if (exiting) {
    delete attributes.id;
    delete attributes["data-testid"];
  }
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    onClick?.(event);
    if (!onBodyClick || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE) && event.currentTarget.contains(target.closest(INTERACTIVE))) return;
    // A drag that selected text is a reader copying something, not a request to open the row.
    if (window.getSelection()?.toString()) return;
    onBodyClick();
  };
  const list = tracks === "list";
  return (
    <Tag
      ref={ref as Ref<never>}
      {...attributes}
      data-active={(active && !exiting) || undefined}
      data-unread={unread || undefined}
      data-highlight={highlight || undefined}
      inert={exiting || undefined}
      aria-hidden={exiting || undefined}
      onClick={handleClick}
      className={cx(
        "relative grid min-h-11 items-start gap-x-1 gap-y-1 px-3 py-2.5 transition-colors duration-[var(--dur-fast)] outline-offset-[-2px] hover:bg-bg-subtle data-active:bg-bg-muted data-active:shadow-[inset_2px_0_0_var(--accent)] data-highlight:animate-highlight @max-split/dashboard:gap-y-1.5",
        // The rule under a list row starts at the title, past the glyph; under a table row it spans the row, as the header's rule does.
        "after:absolute after:right-0 after:bottom-0 after:h-px after:bg-line last:after:hidden",
        list ? "after:left-9" : "after:left-0",
        itemTracks[tracks],
        !list && "gap-x-3",
        onBodyClick && "cursor-pointer",
        className,
      )}
    >
      {list ? (
        <>
          <div className="col-start-1 row-start-1 pt-px">{glyph}</div>
          <div className="col-start-2 row-start-1 grid min-w-0 gap-1 @row/list:row-end-3">
            <div className={cx("min-w-0 text-body [overflow-wrap:anywhere]", unread ? "font-semibold" : "font-medium")}>{title}</div>
            {meta && <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-fg-muted">{meta}</div>}
            {excerpt}
          </div>
          <div className="col-start-3 row-start-1 min-w-0 justify-self-end pl-2 text-right">{aside}</div>
          {rail && <div className="col-start-2 col-end-4 row-start-2 flex min-w-0 items-center @row/list:col-start-3 @row/list:justify-self-end @row/list:pl-2">{rail}</div>}
        </>
      ) : (
        <>
          {/* In a role=row the lead is a cell like the others, or a screen reader's table navigation pairs every following cell with the wrong column header. */}
          <div role={rest.role === "row" ? "cell" : undefined} className="flex min-w-0 items-start gap-2">
            {glyph}
            <div className="grid min-w-0 gap-0.5">
              <div className={cx("min-w-0 text-body [overflow-wrap:anywhere]", unread ? "font-semibold" : "font-medium")}>{title}</div>
              {meta && <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-fg-muted">{meta}</div>}
            </div>
          </div>
          {children}
        </>
      )}
    </Tag>
  );
}

// Splits the formatted heading so the count can be quieter than the label, without the component having to know the locale's pattern: the count and the brackets around it ("(3)", "（3）") are what is dimmed, and the text read aloud is untouched.
function headingParts(heading: string, count: number) {
  const digits = String(count);
  const at = heading.lastIndexOf(digits);
  if (at < 0) return [heading, "", ""] as const;
  let start = at;
  let end = at + digits.length;
  if ("(（".includes(heading[start - 1] ?? "x")) start -= 1;
  if (")）".includes(heading[end] ?? "x")) end += 1;
  return [heading.slice(0, start), heading.slice(start, end), heading.slice(end)] as const;
}

function SectionHeading({ heading, count, id }: { heading: string; count: number; id?: string }) {
  const [label, number, rest] = headingParts(heading, count);
  return (
    <h2 id={id} className="m-0 min-w-0 text-body font-semibold text-fg">
      {label}
      {number && <span className="font-medium text-fg-subtle tabular-nums">{number}</span>}
      {rest}
    </h2>
  );
}

// A group of rows under an h2 that stays pinned while its rows scroll past. `heading` is the full localized string (for example followup.groupHeading); `count` identifies the number inside it. A collapsible section is a native <details>, so it opens and closes without script and is announced as a disclosure.
export function ListSection({
  id,
  heading,
  count,
  collapsible = false,
  defaultOpen = false,
  note,
  children,
  className,
  open,
  onToggle,
}: {
  id: string;
  heading: string;
  count: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  // A collapsible section's open state, when the page tracks it: a disclosure that unmounts and mounts again (its group emptied and came back) then opens in the state the page still believes it is in, rather than closed under a page that thinks it is open.
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const sticky = "sticky top-[var(--topbar-h)] z-[2] bg-bg py-2 shell:top-0";
  if (collapsible)
    return (
      <details id={id} open={(open ?? defaultOpen) || undefined} onToggle={(event) => onToggle?.(event.currentTarget.open)} className={cx("group min-w-0", className)}>
        {/* The chevron hangs in the gutter (-ml-5 is its 14px plus the 6px gap), so the label starts at the same x as every other section's heading. */}
        <summary className={cx(sticky, "-ml-5 flex cursor-pointer list-none items-center gap-1.5 rounded-sm px-1 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden")}>
          <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-fg-subtle transition-transform duration-[var(--dur-fast)] group-open:rotate-90" />
          <SectionHeading heading={heading} count={count} />
        </summary>
        {note && <div className="px-1 pb-2 text-caption text-fg-muted">{note}</div>}
        {children}
      </details>
    );
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cx("min-w-0", className)}>
      <div className={cx(sticky, "px-1")}>
        <SectionHeading id={`${id}-heading`} heading={heading} count={count} />
      </div>
      {note && <div className="px-1 pb-2 text-caption text-fg-muted">{note}</div>}
      {children}
    </section>
  );
}
