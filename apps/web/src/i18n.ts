import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import es from "./locales/es.json";
import { followupLocales } from "./followup-locales";
import { accessLocales } from "./access-locales";
import { namespaceResources } from "./locale-namespaces";
// The per-page namespaces are spread after the frozen files, so a namespace key always means the namespace object.
export const resources = {
  en: { translation: { ...en, followup: followupLocales.en, access: accessLocales.en, ...namespaceResources("en") } },
  "zh-CN": { translation: { ...zh, followup: followupLocales["zh-CN"], access: accessLocales["zh-CN"], ...namespaceResources("zh-CN") } },
  ja: { translation: { ...ja, followup: followupLocales.ja, access: accessLocales.ja, ...namespaceResources("ja") } },
  ko: { translation: { ...ko, followup: followupLocales.ko, access: accessLocales.ko, ...namespaceResources("ko") } },
  es: { translation: { ...es, followup: followupLocales.es, access: accessLocales.es, ...namespaceResources("es") } },
} as const;
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({ resources, supportedLngs: Object.keys(resources), fallbackLng: "en", detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] }, interpolation: { escapeValue: false } });
const updateDocumentLanguage = () => {
  document.documentElement.lang = i18n.resolvedLanguage || i18n.language || "en";
};
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();
export default i18n;
