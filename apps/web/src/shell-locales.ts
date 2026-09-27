import type { LocaleNamespace } from "./locale-namespaces";

// Strings under `shell.*`: the shell, sync and account. Every key needs all five languages: locales.test.mjs checks this namespace for key parity, placeholders and plural categories through the aggregator in locale-namespaces.ts.
export const shellLocales: LocaleNamespace = { en: {}, "zh-CN": {}, ja: {}, ko: {}, es: {} };
