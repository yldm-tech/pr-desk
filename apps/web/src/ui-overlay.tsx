import * as RadixPopover from "@radix-ui/react-popover";
import { Check, Copy, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { dismissToast, useToast } from "./toast";
import { Button, cx, IconButton } from "./ui-controls";

// Portalled into <body>, so nothing inside may rely on a container query: only viewport variants apply here. Radix returns focus to the trigger on close and closes on Escape and on an outside click.
export function Popover({ trigger, label, align = "start", open, onOpenChange, children, className }: { trigger: ReactElement; label?: string; align?: "start" | "end"; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode; className?: string }) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={16}
          aria-label={label}
          className={cx("z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(320px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-line bg-surface p-3 text-body text-fg shadow-1 outline-none animate-pop", className)}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

const sheetSide = {
  // Full screen below the shell breakpoint, where a side sheet would leave a strip too thin to tap; a right sheet above it, whose left edge is the backdrop.
  right: "inset-0 m-0 h-dvh max-h-dvh w-screen max-w-none animate-sheet-up shell:mr-0 shell:ml-auto shell:w-[min(720px,calc(100vw-44px))] shell:rounded-l-xl shell:animate-sheet-right",
  bottom: "mx-0 mt-auto mb-0 max-h-[85dvh] w-screen max-w-none rounded-t-xl animate-sheet-up shell:mx-auto shell:w-[min(720px,calc(100vw-48px))]",
  center: "inset-0 m-0 h-dvh max-h-dvh w-screen max-w-none animate-sheet-up shell:m-auto shell:h-auto shell:max-h-[min(640px,calc(100dvh-96px))] shell:w-[min(640px,calc(100vw-48px))] shell:rounded-xl shell:animate-pop",
} as const;

// A native modal <dialog>: the browser traps focus, makes the page behind it inert, and turns Escape into `cancel`. Escape and a click on the backdrop both call onClose; the owner decides whether to close. Focus goes back to `returnFocusTo`, or to whatever had it when the sheet opened.
export function Sheet({ open, onClose, side, labelledBy, header, footer, children, returnFocusTo, closeLabel, showClose = true, className }: { open: boolean; onClose: () => void; side: "right" | "bottom" | "center"; labelledBy: string; header?: ReactNode; footer?: ReactNode; children: ReactNode; returnFocusTo?: HTMLElement | null; closeLabel?: string; showClose?: boolean; className?: string }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const opener = useRef<Element | null>(null);
  const returnTo = useRef(returnFocusTo);
  returnTo.current = returnFocusTo;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
    }
    if (!open && element.open) element.close();
    return () => {
      if (!open) return;
      if (element.open) element.close();
      const target = returnTo.current ?? opener.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
      className={cx("fixed overflow-hidden border-0 bg-surface p-0 text-fg shadow-2 backdrop:bg-overlay backdrop:animate-fade open:flex open:flex-col", sheetSide[side], className)}
    >
      {open && (
        <>
          {(header || showClose) && (
            <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 roomy:px-5 shell:pt-3">
              <div className="min-w-0 flex-1">{header}</div>
              {/* The first stop on open: on a phone this is the sheet's only visible exit, in the corner where thumb accuracy is worst, so it takes the full 44px on a coarse pointer. */}
              {showClose && <IconButton label={closeLabel ?? t("close")} icon={X} autoFocus onClick={() => close.current()} className="-mt-1 -mr-2" />}
            </header>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 roomy:px-5">{children}</div>
          {footer && <footer className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] roomy:px-5">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

// The one toast slot, drawn from toast.ts. The visible sentence is aria-hidden and a separate polite region says it instead, so it is announced once, with "Undo is available." appended when it is; the controls stay outside aria-hidden, because a control inside it cannot be reached at all. Errors go to an assertive region. It floats above the phone tab bar.
export function ToastRegion() {
  const { t } = useTranslation();
  const toast = useToast();
  const failed = toast?.tone === "error";
  // A trailing no-break space on alternate shows: the same sentence twice in a row would otherwise not change the region, and nothing would be said the second time.
  const pad = toast && toast.seq % 2 ? " " : "";
  const spoken = toast && !failed ? `${toast.text}${toast.undo ? ` ${t("followup.undoAvailable")}` : ""}${pad}` : "";
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
      <p className="sr-only" role="alert">
        {toast && failed ? `${toast.text}${pad}` : ""}
      </p>
      {toast && (
        <div
          key={toast.seq}
          className={cx(
            "fixed bottom-[calc(var(--tabbar-h)+max(16px,env(safe-area-inset-bottom)))] left-1/2 z-40 flex w-max max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 animate-pop items-center gap-2 rounded-lg border border-line-strong bg-surface py-1.5 pr-1.5 pl-3.5 text-body text-fg shadow-1 max-roomy:inset-x-4 max-roomy:w-auto max-roomy:max-w-none max-roomy:translate-x-0 shell:bottom-[max(16px,env(safe-area-inset-bottom))]",
            failed && "border-tone-blocked-line",
          )}
        >
          <span aria-hidden="true" className={cx("min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]", failed && "text-tone-blocked")}>
            {toast.text}
          </span>
          {toast.undo && !failed && (
            <>
              {/* Named through a hidden element: there is one undo slot for the whole app and the next action reassigns it, so the button has to say which row it would restore ("Undo — fixture/calendar #17"). */}
              <span id="follow-up-undo-name" hidden>
                {toast.undo.name}
              </span>
              <Button size="sm" variant="ghost" aria-labelledby="follow-up-undo-name" className="text-accent-text" onClick={() => toast.undo?.run()}>
                {toast.undo.label}
              </Button>
            </>
          )}
          <IconButton label={t("dismissMessage")} icon={X} size="sm" onClick={dismissToast} />
        </div>
      )}
    </>
  );
}

// A destructive action that asks once, in place. The confirm button takes the trigger's place and focus, keeps its name and is described by the question; Escape or Cancel puts the trigger back and focuses it.
export function ConfirmInline({ triggerLabel, question, confirmLabel, cancelLabel, onConfirm, busy = false, className }: { triggerLabel: string; question: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; busy?: boolean; className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [returning, setReturning] = useState(false);
  const promptId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (!returning) return;
    trigger.current?.focus();
    setReturning(false);
  }, [returning]);
  const cancel = () => {
    setConfirming(false);
    setReturning(true);
  };
  return (
    <span
      className={cx("inline-flex flex-wrap items-center gap-2", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && confirming) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {confirming ? (
        <Fragment key="confirm">
          <span id={promptId} className="text-small text-fg">
            {question}
          </span>
          <Button ref={confirm} variant="danger" size="sm" busy={busy} aria-describedby={promptId} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" size="sm" onClick={cancel}>
            {cancelLabel}
          </Button>
        </Fragment>
      ) : (
        <Button key="trigger" ref={trigger} variant="danger" size="sm" onClick={() => setConfirming(true)}>
          {triggerLabel}
        </Button>
      )}
    </span>
  );
}

async function clipboardWrite(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// A value to reproduce exactly (a URL, a config block, a command). The <pre> is focusable because it scrolls: without a pointer there is otherwise no way to reach the part off the right edge. `copy` is the caller's clipboard writer (AccessSettings' writeClipboard, with its fallback); when it reports failure the reader is told to select the text instead.
export function Snippet({ title, code, hint, copyLabel, copy = clipboardWrite, className }: { title: string; code: string; hint?: ReactNode; copyLabel?: string; copy?: (text: string) => Promise<boolean>; className?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <div className={cx("grid min-w-0 gap-1.5", className)}>
      <span id={id} className="text-small font-medium text-fg">
        {title}
      </span>
      <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col items-stretch gap-2 @row/dashboard:flex-row @row/dashboard:items-start">
        <pre tabIndex={0} className="m-0 min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-bg-muted px-3 py-2.5">
          <code className="font-mono text-caption leading-relaxed whitespace-pre text-fg">{code}</code>
        </pre>
        <Button size="sm" icon={state === "copied" ? Check : Copy} aria-label={copyLabel} className="self-start" onClick={() => void copy(code).then((written) => setState(written ? "copied" : "failed"))}>
          {t(state === "copied" ? "access.copied" : "access.copy")}
        </Button>
      </div>
      {state === "failed" && (
        <p role="status" className="text-caption text-tone-action">
          {t("access.copyManual")}
        </p>
      )}
      {hint && <p className="text-caption text-fg-muted">{hint}</p>}
    </div>
  );
}
