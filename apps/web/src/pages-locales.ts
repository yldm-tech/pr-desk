import type { LocaleNamespace } from "./locale-namespaces";

// Strings under `pages.*`: the Welcome and About. Every key needs all five languages: locales.test.mjs checks this namespace for key parity, placeholders and plural categories through the aggregator in locale-namespaces.ts.
export const pagesLocales: LocaleNamespace = {
  en: { welcomeHeadline: "Every pull request that needs you,\nin one list.", aboutTitle: "About PR Desk", version: "Version {{version}}", newTab: "opens in a new tab" },
  "zh-CN": { welcomeHeadline: "所有需要你处理的拉取请求，\n集中在一个列表里。", aboutTitle: "关于 PR Desk", version: "版本 {{version}}", newTab: "在新标签页中打开" },
  ja: { welcomeHeadline: "対応が必要なプルリクエストを、\nひとつのリストに。", aboutTitle: "PR Desk について", version: "バージョン {{version}}", newTab: "新しいタブで開きます" },
  ko: { welcomeHeadline: "내가 처리해야 할 모든 풀 리퀘스트를\n하나의 목록으로.", aboutTitle: "PR Desk 소개", version: "버전 {{version}}", newTab: "새 탭에서 열림" },
  es: { welcomeHeadline: "Todos los pull requests que te necesitan,\nen una sola lista.", aboutTitle: "Acerca de PR Desk", version: "Versión {{version}}", newTab: "se abre en una pestaña nueva" },
};
