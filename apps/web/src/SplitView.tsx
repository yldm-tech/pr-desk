import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { cx } from "./ui-controls";

// The content width at which the Inbox shows the list and the detail side by side. It is the `table` container token (--container-table in style.css): CSS lays the two panes out at the same width through `@table/dashboard`, and this constant is what the script reads, so behaviour (pane or sheet) and layout flip together. Change one and the other has to change with it.
export const SPLIT_MIN = 880;

// Whether the element is at least SPLIT_MIN wide. The element is the SplitView root, a full-width block child of <main>'s dashboard container, so its width is that container's content width, which is exactly what `@table/dashboard` measures. Read in a layout effect so the first paint already knows which mode it is in.
export function useSplitMode(ref: RefObject<HTMLElement | null>): boolean {
  const [split, setSplit] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setSplit(element.getBoundingClientRect().width >= SPLIT_MIN);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSplit(entry.contentRect.width >= SPLIT_MIN);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return split;
}

// The list beside its detail. Below the split width the detail is not rendered at all and the list takes the whole row; the page opens a sheet instead. The detail column is sticky so it stays beside whichever row the reader is looking at while the list scrolls.
export function SplitView({ ref, split, list, detail, className }: { ref: RefObject<HTMLDivElement | null>; split: boolean; list: ReactNode; detail: ReactNode; className?: string }) {
  return (
    <div ref={ref} className={cx("grid min-w-0 gap-4 @table/dashboard:grid-cols-[minmax(400px,5fr)_minmax(440px,6fr)] @table/dashboard:items-start", className)}>
      <div className="min-w-0">{list}</div>
      {split && detail}
    </div>
  );
}
