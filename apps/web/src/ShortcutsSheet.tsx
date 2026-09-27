import { Fragment, useId } from "react";
import { useTranslation } from "react-i18next";
import { overlays, useShortcut } from "./shortcuts";
import { Kbd } from "./ui-controls";
import { Sheet } from "./ui-overlay";

// Keycaps and the two joins between them. A keycap is printed as it is engraved, so it is not translated; "then" joins the strokes of a sequence, and alternatives are separated by a slash that is read out as "or", which keeps a four-way choice such as the snooze presets on one short line.
type Token = string | { join: "then" | "or" };
const then: Token = { join: "then" };
const or: Token = { join: "or" };

// Apple keyboards label the modifier ⌘, every other one Ctrl; useShortcut accepts either on any platform, so this only decides what is printed.
const modKey = () => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl");

function Keys({ tokens }: { tokens: Token[] }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {tokens.map((token, index) => (
        <Fragment key={index}>
          {typeof token === "string" ? (
            <Kbd>{token}</Kbd>
          ) : token.join === "then" ? (
            <span className="px-0.5 text-caption text-fg-subtle">{t("palette.followedBy")}</span>
          ) : (
            <span className="text-caption text-fg-subtle">
              <span aria-hidden="true">/</span>
              <span className="sr-only">{t("palette.or")}</span>
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

// Every key the application binds (spec §8.1), grouped by where it works. The sheet is the reference, so it lists what each surface registers rather than what is registered at this moment: a list key is documented from any page, because the reader is usually asking before they go to the list.
export function ShortcutsSheet() {
  const { t } = useTranslation();
  const open = overlays.useShortcutsOpen();
  const titleId = useId();
  // `?` is a single key and goes through the shared guard, so it is ignored while typing and while any dialog is open, the palette included; the palette has its own "Keyboard shortcuts" entry for that case.
  useShortcut("?", () => overlays.openShortcuts());
  const page = (key: string) => t("palette.keyGoTo", { page: t(key) });
  const sections: { id: string; title: string; rows: { label: string; keys: Token[] }[] }[] = [
    {
      id: "global",
      title: t("palette.sectionGlobal"),
      rows: [
        { label: t("palette.keyPalette"), keys: [modKey(), "K"] },
        { label: t("palette.keyFocusSearch"), keys: ["/"] },
        { label: page("palette.inbox"), keys: ["g", then, "i"] },
        { label: page("palette.pulls"), keys: ["g", then, "p"] },
        { label: page("palette.repos"), keys: ["g", then, "r"] },
        { label: page("palette.insights"), keys: ["g", then, "n"] },
        { label: page("palette.settings"), keys: ["g", then, "s"] },
        { label: t("palette.keyShortcuts"), keys: ["?"] },
      ],
    },
    {
      id: "lists",
      title: t("palette.sectionLists"),
      rows: [
        { label: t("palette.keyNext"), keys: ["j"] },
        { label: t("palette.keyPrevious"), keys: ["k"] },
        { label: t("palette.keyOpen"), keys: ["Enter", or, "Space"] },
        { label: t("palette.keyGitHub"), keys: ["o"] },
        { label: t("palette.keyClear"), keys: ["Esc"] },
      ],
    },
    {
      id: "inbox",
      title: t("palette.sectionInbox"),
      rows: [
        { label: t("palette.keyHandled"), keys: ["e"] },
        { label: t("palette.keySnooze"), keys: ["s", then, "3", or, "7", or, "t", or, "c"] },
        { label: t("palette.keyRead"), keys: ["r"] },
        { label: t("palette.keyUnsnooze"), keys: ["u"] },
        { label: t("palette.keyUndo"), keys: ["z"] },
      ],
    },
    {
      id: "sheet",
      title: t("palette.sectionSheet"),
      rows: [
        { label: t("palette.keyClose"), keys: ["Esc"] },
        { label: t("palette.keySheetVerbs"), keys: ["e", or, "s", or, "r", or, "u"] },
      ],
    },
  ];
  return (
    <Sheet
      open={open}
      onClose={overlays.closeShortcuts}
      side="right"
      labelledBy={titleId}
      closeLabel={t("palette.closeShortcuts")}
      header={
        <div className="grid gap-1">
          <h2 id={titleId} className="text-title font-semibold text-fg">
            {t("palette.shortcuts")}
          </h2>
          <p className="text-small text-fg-muted">{t("palette.shortcutsIntro")}</p>
        </div>
      }
    >
      <div className="grid gap-6 shell:grid-cols-2 shell:gap-x-8">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`${titleId}-${section.id}`} className="min-w-0">
            <h3 id={`${titleId}-${section.id}`} className="pb-1 text-small font-medium text-fg-muted">
              {section.title}
            </h3>
            <dl className="m-0">
              {section.rows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-b-0">
                  <dt className="min-w-0 pt-0.5 text-body text-fg">{row.label}</dt>
                  <dd className="m-0 max-w-[60%] shrink-0">
                    <Keys tokens={row.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

export default ShortcutsSheet;
