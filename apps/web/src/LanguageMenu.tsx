import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resources } from "./i18n";
import { selectContent, selectOption } from "./select-styles";

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  return (
    <Select.Root value={i18n.resolvedLanguage || "en"} onValueChange={(value) => void i18n.changeLanguage(value)}>
      <Select.Trigger className="flex min-h-[38px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[length:var(--text-body)] whitespace-nowrap text-[var(--foreground)] hover:border-[var(--accent-border)] hover:bg-[var(--surface-muted)] data-[state=open]:border-[var(--accent-border)] data-[state=open]:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--accent)] [@media(max-width:800px)_and_(min-width:481px)]:px-2.5 [@media(max-width:640px)_and_(min-width:481px)]:gap-1.5 [@media(max-width:640px)]:text-xs [@media(max-width:480px)]:gap-[5px] [@media(max-width:480px)]:px-2 [@media(max-width:480px)]:py-1.5" aria-label={t("language")}>
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
