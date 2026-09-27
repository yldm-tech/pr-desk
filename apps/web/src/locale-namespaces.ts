import { shellLocales } from "./shell-locales";
import { inboxLocales } from "./inbox-locales";
import { prsLocales } from "./prs-locales";
import { reposLocales } from "./repos-locales";
import { insightsLocales } from "./insights-locales";
import { settingsLocales } from "./settings-locales";
import { pagesLocales } from "./pages-locales";
import { paletteLocales } from "./palette-locales";

export type Language = "en" | "zh-CN" | "ja" | "ko" | "es";
export type LocaleNamespace = Record<Language, Record<string, string>>;

// One module per namespace, each owned by the unit that writes its copy, so parallel work never edits the same locale file. i18n.ts and locales.test.mjs both read this one object, which is what puts a new namespace under the parity, placeholder, plural and used-key checks the moment it is listed here.
export const namespaces: Record<string, LocaleNamespace> = { shell: shellLocales, inbox: inboxLocales, prs: prsLocales, repos: reposLocales, insights: insightsLocales, settings: settingsLocales, pages: pagesLocales, palette: paletteLocales };

export function namespaceResources(language: Language): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(namespaces).map(([namespace, locales]) => [namespace, locales[language]]));
}
