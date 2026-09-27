import type { LocaleNamespace } from "./locale-namespaces";

// Strings under `insights.*`: the Insights and GitHub access. Every key needs all five languages: locales.test.mjs checks this namespace for key parity, placeholders and plural categories through the aggregator in locale-namespaces.ts.
export const insightsLocales: LocaleNamespace = { en: {}, "zh-CN": {}, ja: {}, ko: {}, es: {} };
