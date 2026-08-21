// Package httpx wires the HTTP surface: the admin API, the sign-in routes,
// the static shell and the redirect path that everything else exists to serve.
package httpx

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/collinesfilms/shortify/internal/auth"
	"github.com/collinesfilms/shortify/internal/config"
	"github.com/collinesfilms/shortify/internal/store"
	"github.com/collinesfilms/shortify/web"
)

type Server struct {
	cfg       *config.Config
	st        *store.Store
	sessions  *auth.Sessions
	oidc      *auth.OIDC
	limiter   *attemptLimiter
	assets    fs.FS
	index     []byte
	adminHost string
}

func New(cfg *config.Config, st *store.Store, sessions *auth.Sessions, oidc *auth.OIDC) (*Server, error) {
	assets, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return nil, err
	}
	// A binary built without the interface still runs and still redirects: the
	// short links are the part people depend on. Only the admin shell is
	// missing, and it says so.
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		index = []byte(`<!doctype html><meta charset="utf-8"><title>Link shortener</title>` +
			`<p style="font:15px system-ui;margin:3rem auto;max-width:34rem">` +
			`The interface has not been built. Run ` +
			`<code>npm --prefix web ci &amp;&amp; npm --prefix web run build</code> ` +
			`and rebuild the binary. Redirects already work.</p>`)
	}
	return &Server{
		cfg:       cfg,
		st:        st,
		sessions:  sessions,
		oidc:      oidc,
		limiter:   newAttemptLimiter(),
		assets:    assets,
		index:     index,
		adminHost: hostOnly(strings.TrimPrefix(strings.TrimPrefix(cfg.BaseURL, "https://"), "http://")),
	}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Built assets and self-hosted fonts. Everything under this one prefix, so
	// the root namespace stays free for slugs.
	mux.Handle("GET /_/", http.StripPrefix("/_/", s.assetHandler()))

	// The handful of files browsers insist on fetching from the root. They are
	// reserved slugs, so a link can never shadow them.
	for _, name := range []string{"favicon.ico", "manifest.webmanifest", "sw.js", "apple-touch-icon.png"} {
		mux.Handle("GET /"+name, s.rootFile(name))
	}
	mux.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("User-agent: *\nDisallow: /\n"))
	})
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if err := s.st.DB().PingContext(r.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	if s.oidc != nil {
		mux.HandleFunc("GET /auth/login", s.oidc.Login)
		mux.HandleFunc("GET /auth/callback", s.oidc.Callback)
	}
	mux.Handle("POST /auth/logout", http.HandlerFunc(s.sessions.Logout))

	api := http.NewServeMux()
	api.HandleFunc("GET /api/me", s.handleMe)
	api.HandleFunc("GET /api/settings", s.handleGetSettings)
	api.HandleFunc("PUT /api/settings", s.handlePutSettings)
	api.HandleFunc("GET /api/links", s.handleListLinks)
	api.HandleFunc("POST /api/links", s.handleCreateLink)
	api.HandleFunc("GET /api/links/{id}", s.handleGetLink)
	api.HandleFunc("PATCH /api/links/{id}", s.handleUpdateLink)
	api.HandleFunc("DELETE /api/links/{id}", s.handleDeleteLink)
	api.HandleFunc("POST /api/links/{id}/aliases", s.handleAddAlias)
	api.HandleFunc("GET /api/slug-check", s.handleCheckSlug)
	api.HandleFunc("POST /api/domains", s.handleAddDomain)
	api.HandleFunc("POST /api/domains/{id}/default", s.handleDefaultDomain)
	api.HandleFunc("DELETE /api/domains/{id}", s.handleDeleteDomain)
	mux.Handle("/api/", s.sessions.Require(api))

	mux.HandleFunc("GET /{$}", s.handleRoot)
	mux.HandleFunc("GET /{slug}", s.serveSlug)
	mux.HandleFunc("POST /{slug}", s.serveSlug)

	return securityHeaders(mux)
}

// handleRoot serves the admin shell on the admin host. Other short domains
// have no interface of their own, so they point at the one that does.
func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if hostOnly(r.Host) != s.adminHost && s.adminHost != "" {
		http.Redirect(w, r, s.cfg.BaseURL, http.StatusFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(s.index)
}

func (s *Server) assetHandler() http.Handler {
	files := http.FileServerFS(s.assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Vite fingerprints asset filenames and the fonts never change, so both
		// can be cached hard.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		files.ServeHTTP(w, r)
	})
}

func (s *Server) rootFile(name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, err := fs.ReadFile(s.assets, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		switch {
		case strings.HasSuffix(name, ".webmanifest"):
			w.Header().Set("Content-Type", "application/manifest+json")
		case strings.HasSuffix(name, ".js"):
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		case strings.HasSuffix(name, ".ico"):
			w.Header().Set("Content-Type", "image/x-icon")
		case strings.HasSuffix(name, ".png"):
			w.Header().Set("Content-Type", "image/png")
		}
		// The service worker must be revalidated or a bad one could linger and
		// break every short link the browser has ever seen.
		if strings.HasSuffix(name, "sw.js") {
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		_, _ = w.Write(b)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
