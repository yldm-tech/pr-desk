import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resources } from "./i18n";

export function LanguageMenu() {
  const {t,i18n} = useTranslation();
  return <Select.Root value={i18n.resolvedLanguage || "en"} onValueChange={value=>void i18n.changeLanguage(value)}>
    <Select.Trigger className="language-trigger" aria-label={t("language")}>
      <Languages size={16} aria-hidden="true" />
      <Select.Value />
      <Select.Icon><ChevronDown size={13} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="language-menu" position="popper" align="end" sideOffset={8} collisionPadding={12}>
        <Select.Viewport>
          {Object.keys(resources).map(code=><Select.Item key={code} value={code} className="language-option">
            <Select.ItemText>{t("nativeName",{lng:code})}</Select.ItemText>
            <Select.ItemIndicator><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
