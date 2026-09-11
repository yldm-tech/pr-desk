package main

import (
	"html/template"
	"net/http"
)

// The browser lands here at the end of the authorization round trip, so it is
// the last thing a person sees of this flow. It carries the same mark and the
// same tokens as the consent screen it was redirected from, rather than the
// bare text a loopback handler would otherwise return.
var resultPage = template.Must(template.New("result").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{{.Title}}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light;--canvas:#f7f7f9;--surface:#fff;--foreground:#27272f;--muted:#6b6b78;--border:#e2e2e9;--success:#237a52;--success-soft:#edf7f1;--success-border:#c8e3d3;--muted-soft:#f2f2f5}
*{box-sizing:border-box}
body{background:var(--canvas);color:var(--foreground);font:400 13px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;margin:0;padding:24px;align-items:center;justify-content:center}
main{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 1px 2px #24202e0a,0 12px 32px #24202e0f;padding:28px 24px;max-width:360px;width:100%;text-align:center}
.mark{width:34px;height:34px;border-radius:9px;margin:0 auto 18px;display:block}
.badge{width:40px;height:40px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;background:{{if .Ok}}var(--success-soft){{else}}var(--muted-soft){{end}};color:{{if .Ok}}var(--success){{else}}var(--muted){{end}};{{if .Ok}}border:1px solid var(--success-border){{else}}border:1px solid var(--border){{end}}}
.badge svg{width:19px;height:19px}
h1{font-size:15px;font-weight:600;margin:0 0 6px}
p{color:var(--muted);margin:0}
.hint{margin-top:16px;padding-top:14px;border-top:1px solid #eeeef2;font-size:12px;color:var(--muted)}
</style></head><body><main>
<svg class="mark" viewBox="0 0 128 128" fill="none" aria-hidden="true"><defs><linearGradient id="m" x1="16" y1="8" x2="112" y2="128" gradientUnits="userSpaceOnUse"><stop stop-color="#7768EF"/><stop offset="1" stop-color="#5142BD"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#m)"/><path d="M40 44v40m47-4V59c0-14-9-23-24-23" stroke="#F8F7FF" stroke-width="8" stroke-linecap="round"/><path d="m70 26-11 10 11 10" stroke="#F8F7FF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="40" cy="34" r="10" fill="#6C5DDE" stroke="#F8F7FF" stroke-width="7"/><circle cx="40" cy="94" r="10" fill="#594AC7" stroke="#F8F7FF" stroke-width="7"/><circle cx="87" cy="94" r="12" fill="#B6F3CD"/></svg>
<div class="badge">{{if .Ok}}<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 4.5 6 12 2.5 8.5"/></svg>{{else}}<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 4 4 12M4 4l8 8"/></svg>{{end}}</div>
<h1>{{.Title}}</h1>
<p>{{.Detail}}</p>
<p class="hint">You can close this tab and return to your terminal.</p>
</main></body></html>`))

type resultView struct {
	Ok     bool
	Title  string
	Detail string
}

var (
	authorizedView = resultView{Ok: true, Title: "Authorization complete", Detail: "This machine can now reach PR Desk on your behalf."}
	declinedView   = resultView{Title: "Authorization declined", Detail: "Nothing was granted. Run the login command again if this was not what you meant."}
	mismatchView   = resultView{Title: "Authorization could not be verified", Detail: "The redirect did not carry the value this login started with, so it was refused. Run the login command again."}
)

// The status is carried explicitly because a declined or unverifiable round
// trip is still a completed HTTP exchange from the browser's point of view;
// only the outcome reported to the person differs.
func writeResultPage(w http.ResponseWriter, status int, view resultView) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_ = resultPage.Execute(w, view)
}
