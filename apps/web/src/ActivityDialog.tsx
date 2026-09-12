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
      className="my-0 mr-0 ml-auto h-[100dvh] max-h-[100dvh] w-[min(640px,100vw)] max-w-[100vw] overflow-auto border-0 bg-[var(--surface)] p-0 text-[var(--foreground)] backdrop:bg-[var(--overlay)]"
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
        <header className="sticky top-0 z-[2] flex flex-row items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-5">
          <h2 className="m-0 text-[15px] leading-[1.6] [overflow-wrap:anywhere]" id="activity-title">
            {title}
          </h2>
          <button className="static grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[24px] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" aria-label={t("close")} autoFocus onClick={onClose}>
            ×
          </button>
        </header>
        {/* The activity panel is not converted yet, so its last section keeps the
            gap this container used to give it. */}
        <div className="flex flex-1 flex-col px-6 py-0 [&>.activity-section:last-of-type]:mb-6">{children}</div>
      </section>
    </dialog>
  );
}
