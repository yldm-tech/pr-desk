import { useTranslation } from "react-i18next";
import { resources } from "./i18n";
import { Select } from "./ui-controls";

// The interface language, as a native select: the platform picker is the right control on every pointer, and each option is written in its own language so a reader who cannot read the current one can still find theirs. The choice persists through i18next's detector (localStorage.i18nextLng) and i18n.ts keeps <html lang> in step.
export function LanguageSelect({ hideLabel = false, className }: { hideLabel?: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const options = Object.keys(resources).map((code) => ({ value: code, label: t("nativeName", { lng: code }) }));
  return <Select label={t("language")} hideLabel={hideLabel} options={options} value={i18n.resolvedLanguage || "en"} onChange={(event) => void i18n.changeLanguage(event.target.value)} className={className} />;
}

// The name the shell used before the select replaced the Radix menu.
export const LanguageMenu = LanguageSelect;
