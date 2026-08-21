# Collines Go

A self-hosted URL shortener for `go.collines.co`, built around one gesture:
open the tab, the link is already in the box, one tap puts the short URL on
your clipboard. `Shortify` is only the repository name — the product is
Collines Go.

The interface is in French throughout, admin and visitor pages alike.

Primary use is handing links to students in class, so the visitor-facing
pages matter as much as the admin UI.

## Status

Design phase. `design/prototype.html` is a clickable prototype of the whole
UI — real motion, real QR codes, fake data. Stills in `design/review/`,
per-state captures in `design/shots/`.

## Decided

**Auth** — PocketID (OIDC) only. No sign-up, no local login. Authorisation is
delegated entirely to PocketID: if the login succeeds for this client, you're
in. Links are owned by the PocketID subject so a second person can be added
later without a migration.

**Slugs** — 5 characters from a lowercase alphabet with `0 o 1 l i` removed,
so a code read off a projector doesn't get mistyped. Lookup is
case-insensitive. Custom slugs allowed, checked for availability as you type.
Deletes are soft and a slug is never handed out twice.

**Routing** — `go.collines.co/<slug>` with no prefix. The admin UI lives at
`/`, its assets under a single reserved prefix, and the reserved slug list
covers the root files (`favicon.ico`, `robots.txt`, `manifest.webmanifest`,
`sw.js`, `.well-known/*`).

**Redirects** — always 302 with `Cache-Control: no-store`. A 301 would be
cached permanently by browsers and proxies, which breaks reviving and
re-pointing links.

**Service worker** — caches the admin shell only, and passes every other
navigation straight to the network. A root-scoped SW that ever serves a
cached response for `/<slug>` would break every link already handed out.

**Options** — custom slug, password, expiry. Expiry leads with relative
presets (1 hour / end of today / 7 days / 30 days) because a class link is
almost always "today"; a date picker sits behind one more tap. Expired links
are kept and can be revived on the same slug.

**Stats** — total opens, uniques via a daily-rotating salted hash, last
opened. No IP storage, no cookies on the redirect path. A list row shows the
open count bottom-right with an icon; the 7-day sparkline lives in the link's
detail sheet.

**Dashboard** — the link list and a link's detail are two separate sheets.
Opening a detail retracts the list and raises the detail; going back reverses
it. That also lets the result screen open a link's detail sheet directly,
without passing through the list.

**Account** — the avatar opens by width only, keeping its height, into a
single `Déconnexion` action. Clicking anywhere else dismisses it.

**The created link** is presented as a tear-off ticket: the short URL above a
perforation — two notches cut into the card's edges and a dashed rule between
them — and the clipboard confirmation on the stub below. The slug settles in
character by character as it arrives, then stays still.

**Clipboard** — auto-paste is attempted on load and works where the browser
grants clipboard-read without a gesture; everywhere else the paste button is
one tap and the failure is invisible. Auto-copy on create hands the clipboard
a promise rather than a string, so it survives Safari's gesture rules.

## Stack

Go + SQLite backend with the built SPA embedded in the binary; React + Vite
frontend. One container, no runtime dependencies, backup is one file.
The short domain is configuration, not a constant — a shorter one can be
added later and served alongside.

## Not in v1

Bulk create, tags and collections, Web Share Target, fullscreen present mode,
API tokens, custom OG previews.
