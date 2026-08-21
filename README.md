# Collines Go

A self-hosted URL shortener for `go.collines.co`, built around one gesture:
open the tab, the link is already in the box, one tap puts the short URL on
your clipboard. `Shortify` is only the repository name — the product is
Collines Go.

The interface is in French throughout, admin and visitor pages alike.

Primary use is handing links to students in class, so the visitor-facing
pages matter as much as the admin UI.

## Running it

```sh
cp .env.example .env      # fill in PocketID and a session key
docker compose up -d
```

One container, one SQLite file in `./data`, no other services. The image is
about 30 MB and builds for amd64 and arm64 alike — the SQLite driver is pure
Go, so there is no C toolchain involved in cross-compiling for a NAS.

### PocketID

Create an OAuth2 client with the redirect URL
`https://go.collines.co/auth/callback`, then grant it to the accounts that
should be able to create links. That grant *is* the authorisation: there is no
user management in this app, and revoking access in PocketID revokes it here.

### Reverse proxy

Every short domain has to reach this container and have its own certificate.
With Caddy that is the whole configuration:

```caddyfile
go.collines.co, clns.li {
    reverse_proxy collinesgo:8080
}
```

Leave `CG_TRUST_PROXY=true` so the client address is read from
`X-Forwarded-For`; it is used to rate-limit password attempts, never stored.

### Adding a short domain later

Add it under Réglages → Domaines, point it at this server, and give it a
certificate. Existing links keep the domain they were created on; new ones use
whichever domain is marked as the default.

### Backups

Copy `data/collinesgo.db` (plus `-wal` and `-shm` if present). That is the
whole application state.

## Development

```sh
npm --prefix web ci
npm --prefix web run build        # the binary embeds web/dist
go run ./cmd/collinesgo
```

For frontend work, `npm --prefix web run dev` proxies `/api` and `/auth` to a
`go run` on :8080.

```sh
go test ./...                     # store and HTTP behaviour
npm --prefix web run typecheck
```

The Go binary embeds the built interface, so the deployed artefact is a single
file with no assets to ship beside it. A binary built without `web/dist` still
runs and still redirects — only the admin shell is missing, and it says so.

## How it is put together

```
cmd/collinesgo      entry point, configuration, graceful shutdown
internal/config     environment, validated all at once at startup
internal/store      SQLite: schema, links, slugs, clicks
internal/auth       PocketID sign-in (OIDC + PKCE) and sessions
internal/httpx      API, redirect path, server-rendered visitor pages
web/                React interface, embedded into the binary
design/             the prototype the interface was designed against
```

`internal/auth` splits `Sessions` from `OIDC` on purpose: reading a session
touches nothing but the database, so the whole request path is testable
without a live identity provider.

## Decisions

**Auth** — PocketID (OIDC) only. No sign-up, no local login. Authorisation is
delegated entirely to PocketID: if the login succeeds for this client, you're
in. Links are owned by the PocketID subject so a second person can be added
later without a migration.

**Slugs** — 5 characters (configurable, 4–12) from a lowercase alphabet with
`0 o 1 l i` removed, so a code read off a projector doesn't get mistyped.
Lookup is case-insensitive. Custom slugs are checked for availability as you
type. Deletes are soft and a slug is never handed out twice.

**Routing** — `go.collines.co/<slug>` with no prefix. The admin UI lives at
`/`, its assets under `/_/`, and the reserved slug list covers the root files
(`favicon.ico`, `robots.txt`, `manifest.webmanifest`, `sw.js`, `.well-known`).

**Redirects** — always 302 with `Cache-Control: no-store`. A 301 would be
cached permanently by browsers and proxies, which breaks reviving and
re-pointing links.

**Service worker** — caches the admin shell only, and passes every other
navigation straight to the network. A root-scoped SW that ever served a cached
response for `/<slug>` would break every link already handed out, silently and
for exactly the people who use the interface. It also has an `unregister`
message so a bad worker can be evicted remotely.

**Options** — custom slug, password, expiry. Expiry leads with relative
presets (1 hour / end of today / 7 days / 30 days) because a class link is
almost always "today"; a date picker sits behind one more tap. Expired links
are kept and can be revived on the same slug.

**Passwords** — bcrypt, and the gate is a page at the slug's own path rather
than a separate URL. Attempts are rate-limited per address and slug so a
protected link is not a free guessing oracle.

**Stats** — total opens, uniques via a daily-rotating salted hash, last
opened. No IP storage, no cookies on the redirect path. The salt is discarded
when the day turns, so a visitor cannot be recomputed or followed across days.
A list row shows the open count bottom-right with an icon; the 7-day sparkline
lives in the link's detail sheet.

**Fonts** — Be Vietnam Pro and DM Mono are self-hosted. The visitor pages are
what students load, and they should not have to contact a font CDN to find out
a link expired.

**Clipboard** — auto-paste is attempted on load and works where the browser
grants clipboard-read without a gesture; everywhere else the paste button is
one tap and the failure is invisible. Auto-copy on create hands the clipboard
a promise rather than a string, so it survives Safari's gesture rules.

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

**QR codes** are generated in-tree (byte mode, EC level M, versions 1–10),
verified module for module against python-qrcode and decoded across a 258-case
corpus, so the page pulls in no third-party script to draw them.

## Not in v1

Bulk create, tags and collections, Web Share Target, fullscreen present mode
beyond the QR view, API tokens, custom OG previews.
