import { useTranslation } from "react-i18next";
import { useEffect, useRef, type ReactNode } from "react";

export function ActivityDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      // margin is written per side: m-0 and ml-auto would both target the left.
      // The 2.75rem the width gives up is the backdrop. The click handler below closes only when the event lands on the dialog itself, which in practice means the ::backdrop, because the inner <section> fills the element edge to edge; at 100vw there is no backdrop left to hit, so on a phone the sheet's only exit was the close button. 2.75rem is the coarse-pointer minimum, and since the width is a min() the sheet is still exactly 640px on any viewport of 684px or more — no width variant needed.
      className="my-0 mr-0 ml-auto h-[100dvh] max-h-[100dvh] w-[min(640px,calc(100vw-2.75rem))] max-w-[100vw] overflow-auto border-0 bg-[var(--surface)] p-0 text-[var(--foreground)] backdrop:bg-[var(--overlay)]"
      aria-labelledby="activity-title"
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <section className="relative flex min-h-[100dvh] w-full flex-col overflow-visible bg-[var(--surface)] p-0 shadow-none [&_code]:min-w-0 [&_code]:[overflow-wrap:anywhere]">
        {/* The dialog is a sibling of <main>, so it sits outside @container/dashboard and has to measure the viewport. The narrow padding pays for the wider close button below, which would otherwise take its extra 8px out of the title. */}
        <header className="sticky top-0 z-[2] flex flex-row items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-5 max-roomy:px-4">
          <h2 className="m-0 text-[length:0.9375rem] leading-[1.6] [overflow-wrap:anywhere]" id="activity-title">
            {title}
          </h2>
          {/* On a phone this is the sheet's only exit besides the backdrop strip, and it sits in the top-right corner where thumb accuracy is worst, so it takes the full 44px floor on a coarse pointer. */}
          <button
            className="static grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[length:1.5rem] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] pointer-coarse:h-11 pointer-coarse:w-11"
            aria-label={t("close")}
            autoFocus
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {/* The activity panel is not converted yet, so its last section keeps the
            gap this container used to give it. */}
        <div className="flex flex-1 flex-col px-6 py-0 max-roomy:px-4 [&>.activity-section:last-of-type]:mb-6">{children}</div>
      </section>
    </dialog>
  );
}
