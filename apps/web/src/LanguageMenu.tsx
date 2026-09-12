import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resources } from "./i18n";
import { selectContent, selectOption } from "./select-styles";

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  return (
    <Select.Root value={i18n.resolvedLanguage || "en"} onValueChange={(value) => void i18n.changeLanguage(value)}>
      {/* The trigger renders inside <main>, so its steps measure @container/dashboard rather than the window, and each one is a single lower edge: the compound (max-width) and (min-width) pairs this replaces could not be ordered against each other by writing order alone. The 38px minimum stays for a fine pointer; a coarse one takes the 44px floor, which the old narrow branch never raised. */}
      <Select.Trigger
        className="flex min-h-[38px] shrink-0 cursor-pointer items-center justify-center gap-[5px] rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[length:0.75rem] whitespace-nowrap text-[var(--foreground)] hover:border-[var(--accent-border)] hover:bg-[var(--surface-muted)] data-[state=open]:border-[var(--accent-border)] data-[state=open]:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)] @split/dashboard:gap-1.5 @split/dashboard:px-2.5 @split/dashboard:py-2 @row/dashboard:gap-2 @row/dashboard:text-[length:var(--text-body)] @table/dashboard:px-3 pointer-coarse:min-h-11"
        aria-label={t("language")}
      >
        <Languages size={16} aria-hidden="true" />
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={13} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={`${selectContent} min-w-[180px]`} position="popper" align="end" sideOffset={8} collisionPadding={12}>
          <Select.Viewport>
            {Object.keys(resources).map((code) => (
              <Select.Item key={code} value={code} className={`${selectOption} gap-6`}>
                <Select.ItemText>{t("nativeName", { lng: code })}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={15} aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
