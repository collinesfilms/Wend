package httpx

import (
	"html/template"
	"net/http"
	"strings"

	"github.com/collinesfilms/wend/locales"
)

// The pages a visitor can land on. They are server-rendered, self-contained and
// make no external requests: students hit these, so nothing about them leaves
// the server they came from.
var visitorTmpl = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="{{.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>{{.Title}}</title>
<style>
@font-face{font-family:"Be Vietnam Pro";src:url("/_/fonts/bevietnampro-400.woff2") format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Be Vietnam Pro";src:url("/_/fonts/bevietnampro-500.woff2") format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:"Be Vietnam Pro";src:url("/_/fonts/bevietnampro-600.woff2") format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"DM Mono";src:url("/_/fonts/dmmono-400.woff2") format("woff2");font-weight:400;font-display:swap}
:root{
  --ground:#ECEEEA;--surface:#F7F8F5;--raised:#FFFFFF;--sunken:#E3E6E0;
  --ink:#1A1C19;--ink-2:#585C54;--ink-3:#8A8F84;--line:#DBDED6;
  --clay:#A9634C;--clay-tint:#F0E1DA;--slate:#5C7391;--slate-tint:#DFE5EE;
  --danger:#A6503F;--on-accent:#fff;
  --shadow:0 2px 6px rgba(26,28,25,.06), 0 10px 26px rgba(26,28,25,.07);
}
@media (prefers-color-scheme:dark){:root{
  --ground:#141613;--surface:#1C1F1A;--raised:#232722;--sunken:#101210;
  --ink:#EAEDE6;--ink-2:#9AA093;--ink-3:#6C7267;--line:#2C302A;
  --clay:#CE8A70;--clay-tint:#2E231E;--slate:#8CA5C6;--slate-tint:#1E242D;
  --danger:#D07E6A;--on-accent:#14160F;
  --shadow:0 2px 6px rgba(0,0,0,.34), 0 10px 26px rgba(0,0,0,.4);
}}
*{box-sizing:border-box}
body{
  margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
  background:var(--ground);color:var(--ink);
  font-family:"Be Vietnam Pro",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;
}
.plate{
  width:100%;max-width:392px;background:var(--surface);border:1px solid var(--line);
  border-radius:24px;box-shadow:var(--shadow);padding:30px 26px 24px;text-align:center;
  animation:rise 520ms cubic-bezier(.32,.72,0,1) both;
}
@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
.mark{
  width:46px;height:46px;border-radius:14px;margin:0 auto 16px;display:grid;place-items:center;
  background:var(--slate-tint);color:var(--slate);
}
.mark.dead{background:var(--sunken);color:var(--ink-3)}
h1{margin:0 0 6px;font-size:20px;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
p{margin:0 auto;max-width:32ch;font-size:13px;line-height:1.5;color:var(--ink-2);text-wrap:balance}
form{margin:0}
.field{
  display:flex;align-items:center;gap:8px;height:48px;margin-top:18px;padding:0 6px 0 14px;
  background:var(--raised);border:1px solid var(--line);border-radius:13px;
}
.field:focus-within{border-color:var(--slate);box-shadow:0 0 0 3px rgba(92,115,145,.13)}
.field input{
  flex:1;min-width:0;height:100%;border:0;background:none;color:var(--ink);outline:none;
  font-family:"DM Mono",ui-monospace,Menlo,monospace;font-size:14px;letter-spacing:.08em;
}
.field input::placeholder{letter-spacing:normal;color:var(--ink-3)}
button{
  width:100%;height:46px;margin-top:12px;border:0;border-radius:13px;cursor:pointer;
  font-family:inherit;font-size:14px;font-weight:500;
  background:var(--slate);color:var(--on-accent);
  transition:transform 180ms cubic-bezier(.32,.72,0,1),filter 180ms;
}
button:hover{transform:translateY(-1px);filter:brightness(1.06)}
.fine{margin-top:14px;font-size:11.5px;color:var(--ink-3);line-height:1.5;text-wrap:balance}
.fine.bad{color:var(--danger)}
.foot{
  margin-top:18px;padding-top:14px;border-top:1px solid var(--line);
  font-family:"DM Mono",ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--ink-3);
  word-break:break-all;
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<main class="plate">
  <span class="mark{{if .Dead}} dead{{end}}">
    {{if eq .Icon "expired"}}
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="8.8"/><path d="M12 6.8v5.6l3.6 2.1"/></svg>
    {{else if eq .Icon "missing"}}
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M10.2 13.8a4.4 4.4 0 006.2 0l2.2-2.2a4.4 4.4 0 10-6.2-6.2l-1.1 1.1"/><path d="M13.8 10.2a4.4 4.4 0 00-6.2 0l-2.2 2.2a4.4 4.4 0 106.2 6.2l1.1-1.1"/></svg>
    {{else}}
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="2.8"/><path d="M8 10V7.2a4 4 0 018 0V10"/></svg>
    {{end}}
  </span>
  <h1>{{.Heading}}</h1>
  <p>{{.Body}}</p>
  {{if .ShowForm}}
  <form method="POST" action="{{.Action}}">
    <div class="field">
      <input type="password" name="password" placeholder="{{.Placeholder}}" autocomplete="off" autofocus required>
    </div>
    <button type="submit">{{.Submit}}</button>
  </form>
  {{end}}
  {{if .Note}}<div class="fine{{if .NoteBad}} bad{{end}}">{{.Note}}</div>{{end}}
  {{if .Foot}}<div class="foot">{{.Foot}}</div>{{end}}
</main>
</body>
</html>`))

type pageData struct {
	Lang        string
	Title       string
	Heading     string
	Body        string
	Note        string
	NoteBad     bool
	Foot        string
	Action      string
	Placeholder string
	Submit      string
	ShowForm    bool
	Dead        bool
	Icon        string // "locked", "expired" or "missing"
}

func renderPage(w http.ResponseWriter, status int, d pageData) {
	if d.Lang == "" {
		d.Lang = locales.Default
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.WriteHeader(status)
	_ = visitorTmpl.Execute(w, d)
}

func (s *Server) gatePage(w http.ResponseWriter, shortURL string, wrong bool) {
	lang := s.cfg.Lang
	d := pageData{
		Lang:        lang,
		Title:       locales.Visitor(lang, "gate.title"),
		Heading:     locales.Visitor(lang, "gate.heading"),
		Body:        locales.Visitor(lang, "gate.body"),
		Foot:        strings.TrimPrefix(shortURL, "https://"),
		Action:      "",
		Placeholder: locales.Visitor(lang, "gate.placeholder"),
		Submit:      locales.Visitor(lang, "gate.submit"),
		ShowForm:    true,
		Icon:        "locked",
	}
	status := http.StatusUnauthorized
	if wrong {
		d.Note = locales.Visitor(lang, "gate.wrong")
		d.NoteBad = true
	}
	renderPage(w, status, d)
}

func (s *Server) expiredPage(w http.ResponseWriter, shortURL, when string) {
	lang := s.cfg.Lang
	body := locales.Visitor(lang, "expired.body")
	if when != "" {
		body = locales.Visitor(lang, "expired.body_dated", "date", when)
	}
	renderPage(w, http.StatusGone, pageData{
		Lang:    lang,
		Title:   locales.Visitor(lang, "expired.title"),
		Heading: locales.Visitor(lang, "expired.heading"),
		Body:    body,
		Foot:    strings.TrimPrefix(shortURL, "https://"),
		Dead:    true,
		Icon:    "expired",
	})
}

func (s *Server) notFoundPage(w http.ResponseWriter, shortURL string) {
	lang := s.cfg.Lang
	renderPage(w, http.StatusNotFound, pageData{
		Lang:    lang,
		Title:   locales.Visitor(lang, "missing.title"),
		Heading: locales.Visitor(lang, "missing.heading"),
		Body:    locales.Visitor(lang, "missing.body"),
		Foot:    strings.TrimPrefix(shortURL, "https://"),
		Dead:    true,
		Icon:    "missing",
	})
}

func (s *Server) tooManyPage(w http.ResponseWriter, shortURL string) {
	lang := s.cfg.Lang
	renderPage(w, http.StatusTooManyRequests, pageData{
		Lang:    lang,
		Title:   locales.Visitor(lang, "throttled.title"),
		Heading: locales.Visitor(lang, "throttled.heading"),
		Body:    locales.Visitor(lang, "throttled.body"),
		Foot:    strings.TrimPrefix(shortURL, "https://"),
		Dead:    true,
		Icon:    "locked",
	})
}
