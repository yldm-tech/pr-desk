import { useTranslation } from "react-i18next";
import { useEffect, useRef, type ReactNode } from "react";

export function ActivityDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
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
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="activity-dialog"
      aria-labelledby="activity-title"
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <section className="drawer">
        <header className="drawer-heading"><h2 id="activity-title">{title}</h2><button
          className="drawerclose"
          aria-label={t("close")}
          autoFocus
          onClick={onClose}
        >
          ×
        </button>
        </header><div className="drawer-content">{children}</div>
      </section>
    </dialog>
  );
}
