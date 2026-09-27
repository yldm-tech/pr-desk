import type { LocaleNamespace } from "./locale-namespaces";

// Strings under `pages.*`: the Welcome and About. Every key needs all five languages: locales.test.mjs checks this namespace for key parity, placeholders and plural categories through the aggregator in locale-namespaces.ts.
export const pagesLocales: LocaleNamespace = { en: {}, "zh-CN": {}, ja: {}, ko: {}, es: {} };
