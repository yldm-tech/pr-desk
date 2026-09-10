import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import es from "./locales/es.json";
export const resources = { en: { translation: en }, "zh-CN": { translation: zh }, ja: { translation: ja }, ko: { translation: ko }, es: { translation: es } } as const;
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
