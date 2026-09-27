// Applies the reader's explicit theme choice before the first paint. It is a classic script loaded synchronously from <head>, and a file rather than an inline block because the API's Content-Security-Policy is `default-src 'self'`, which refuses inline scripts. Without it an explicit "light" under a dark system theme (or the reverse) would paint the wrong theme and then flip once the bundle loaded. src/theme.ts owns the same key and values; the service worker pre-caches this file so an offline launch still gets it.
(function () {
  var pref = null;
  try {
    pref = localStorage.getItem("prdesk-theme");
  } catch {
    // Storage is blocked; the system theme applies.
  }
  if (pref !== "light" && pref !== "dark") return;
  document.documentElement.dataset.theme = pref;
  var color = pref === "dark" ? "#0F0F12" : "#FFFFFF";
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", color);
})();
