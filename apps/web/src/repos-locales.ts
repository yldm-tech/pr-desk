import type { LocaleNamespace } from "./locale-namespaces";

// Strings under `repos.*`: the Repositories. Every key needs all five languages: locales.test.mjs checks this namespace for key parity, placeholders and plural categories through the aggregator in locale-namespaces.ts.
export const reposLocales: LocaleNamespace = { en: {}, "zh-CN": {}, ja: {}, ko: {}, es: {} };
