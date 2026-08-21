package httpx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/collinesfilms/shortify/internal/auth"
	"github.com/collinesfilms/shortify/internal/config"
	"github.com/collinesfilms/shortify/internal/store"
)

type harness struct {
	t       *testing.T
	st      *store.Store
	handler http.Handler
	cookie  *http.Cookie
}

func setup(t *testing.T) *harness {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	ctx := context.Background()
	if err := st.EnsureDomains(ctx, []string{"go.collines.co", "clns.li"}); err != nil {
		t.Fatalf("domains: %v", err)
	}
	if err := st.UpsertUser(ctx, store.User{ID: "sub-1", Email: "prof@collines.co", Name: "Prof"}); err != nil {
		t.Fatalf("user: %v", err)
	}

	cfg := &config.Config{
		BaseURL: "https://go.collines.co",
		Domains: []string{"go.collines.co", "clns.li"},
	}
	// No identity provider is needed here: sessions are seeded directly, which
	// is exactly why they live apart from the OIDC flow.
	sessions := auth.NewSessions(st, false)
	srv, err := New(cfg, st, sessions, nil)
	if err != nil {
		t.Fatalf("server: %v", err)
	}

	token := "test-token-value"
	sum := sha256.Sum256([]byte(token))
	if _, err := st.DB().ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		hex.EncodeToString(sum[:]), "sub-1",
		time.Now().UTC().Format(time.RFC3339),
		time.Now().UTC().Add(time.Hour).Format(time.RFC3339)); err != nil {
		t.Fatalf("session: %v", err)
	}

	return &harness{t: t, st: st, handler: srv.Handler(),
		cookie: &http.Cookie{Name: "cg_session", Value: token}}
}

func (h *harness) do(method, target string, body string, authed bool) *httptest.ResponseRecorder {
	h.t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	if authed {
		r.AddCookie(h.cookie)
	}
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	return w
}

func (h *harness) createLink(t *testing.T, body string) map[string]any {
	t.Helper()
	w := h.do(http.MethodPost, "https://go.collines.co/api/links", body, true)
	if w.Code != http.StatusCreated {
		t.Fatalf("create link: %d %s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func TestApiRequiresASession(t *testing.T) {
	h := setup(t)
	for _, target := range []string{"/api/me", "/api/links", "/api/settings"} {
		w := h.do(http.MethodGet, "https://go.collines.co"+target, "", false)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s without a session = %d, want 401", target, w.Code)
		}
	}
}

func TestRedirectIsAlwaysTemporaryAndUncached(t *testing.T) {
	h := setup(t)
	h.createLink(t, `{"dest":"https://collines.co/tp","slug":"tp-3"}`)

	w := h.do(http.MethodGet, "https://go.collines.co/tp-3", "", false)
	// A 301 would be cached by browsers and proxies for good, and reviving or
	// re-pointing the link would then silently fail for anyone who used it.
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", w.Code)
	}
	if got := w.Header().Get("Location"); got != "https://collines.co/tp" {
		t.Fatalf("Location = %q", got)
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Fatalf("Cache-Control = %q, want no-store", cc)
	}
}

func TestSlugLookupIsCaseInsensitive(t *testing.T) {
	h := setup(t)
	h.createLink(t, `{"dest":"https://collines.co/tp","slug":"lab-3"}`)
	w := h.do(http.MethodGet, "https://go.collines.co/LAB-3", "", false)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 for a capitalised slug", w.Code)
	}
}

func TestUnknownSlugGetsABrandedPage(t *testing.T) {
	h := setup(t)
	w := h.do(http.MethodGet, "https://go.collines.co/nope", "", false)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
	if !strings.Contains(w.Body.String(), "This link does not exist") {
		t.Fatal("the 404 should be the branded French page")
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q", ct)
	}
}

func TestExpiredLinkIsGoneNotRedirected(t *testing.T) {
	h := setup(t)
	past := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	h.createLink(t, `{"dest":"https://collines.co/x","slug":"old","expires_at":"`+past+`"}`)

	w := h.do(http.MethodGet, "https://go.collines.co/old", "", false)
	if w.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", w.Code)
	}
	if !strings.Contains(w.Body.String(), "This link has expired") {
		t.Fatal("expected the expired page")
	}
}

func TestPasswordGate(t *testing.T) {
	h := setup(t)
	h.createLink(t, `{"dest":"https://collines.co/secret","slug":"prive","password":"chambre-42"}`)

	// A protected link is a page at the same path, not a redirect.
	w := h.do(http.MethodGet, "https://go.collines.co/prive", "", false)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("GET status = %d, want 401", w.Code)
	}
	if !strings.Contains(w.Body.String(), "This link is protected") {
		t.Fatal("expected the password gate")
	}
	if strings.Contains(w.Body.String(), "collines.co/secret") {
		t.Fatal("the gate must not leak the destination")
	}

	form := url.Values{"password": {"mauvais"}}.Encode()
	r := httptest.NewRequest(http.MethodPost, "https://go.collines.co/prive", strings.NewReader(form))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w = httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	if w.Code == http.StatusFound {
		t.Fatal("a wrong password must not redirect")
	}

	form = url.Values{"password": {"chambre-42"}}.Encode()
	r = httptest.NewRequest(http.MethodPost, "https://go.collines.co/prive", strings.NewReader(form))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w = httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	if w.Code != http.StatusFound {
		t.Fatalf("correct password status = %d, want 302", w.Code)
	}
	if got := w.Header().Get("Location"); got != "https://collines.co/secret" {
		t.Fatalf("Location = %q", got)
	}
}

func TestPasswordAttemptsAreRateLimited(t *testing.T) {
	h := setup(t)
	h.createLink(t, `{"dest":"https://collines.co/secret","slug":"brute","password":"chambre-42"}`)

	limited := false
	for i := 0; i < 12; i++ {
		form := url.Values{"password": {"faux"}}.Encode()
		r := httptest.NewRequest(http.MethodPost, "https://go.collines.co/brute", strings.NewReader(form))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.RemoteAddr = "203.0.113.9:1234"
		w := httptest.NewRecorder()
		h.handler.ServeHTTP(w, r)
		if w.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("a protected link should not be a free guessing oracle")
	}
}

func TestReservedSlugsAreRefused(t *testing.T) {
	h := setup(t)
	for _, slug := range []string{"api", "sw.js", "favicon.ico", "auth"} {
		w := h.do(http.MethodPost, "https://go.collines.co/api/links",
			`{"dest":"https://collines.co/x","slug":"`+slug+`"}`, true)
		if w.Code != http.StatusConflict {
			t.Errorf("slug %q accepted with status %d, want 409", slug, w.Code)
		}
	}
}

func TestServerPathsAreNotShadowedBySlugs(t *testing.T) {
	h := setup(t)
	// /api is reserved, so this route must still be the API and not a 404 page.
	w := h.do(http.MethodGet, "https://go.collines.co/api/me", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("/api/me = %d, want 200", w.Code)
	}
	w = h.do(http.MethodGet, "https://go.collines.co/robots.txt", "", false)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "Disallow: /") {
		t.Fatalf("robots.txt = %d %q", w.Code, w.Body.String())
	}
}

func TestDangerousDestinationsAreRefused(t *testing.T) {
	h := setup(t)
	for _, dest := range []string{
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"not a url",
	} {
		body, _ := json.Marshal(map[string]string{"dest": dest})
		w := h.do(http.MethodPost, "https://go.collines.co/api/links", string(body), true)
		if w.Code != http.StatusBadRequest {
			t.Errorf("dest %q accepted with status %d", dest, w.Code)
		}
	}
}

func TestGeneratedSlugAvoidsAmbiguousCharacters(t *testing.T) {
	h := setup(t)
	for i := 0; i < 25; i++ {
		link := h.createLink(t, `{"dest":"https://collines.co/x"}`)
		slug, _ := link["slug"].(string)
		if slug == "" {
			t.Fatal("no slug generated")
		}
		if strings.ContainsAny(slug, "ilo01") {
			t.Fatalf("generated slug %q contains a character that gets mistyped", slug)
		}
	}
}

func TestPasswordIsStoredHashed(t *testing.T) {
	h := setup(t)
	link := h.createLink(t, `{"dest":"https://collines.co/x","slug":"hash","password":"chambre-42"}`)
	if link["has_password"] != true {
		t.Fatal("has_password should be true")
	}
	// The API must never hand the password back, in any shape.
	if strings.Contains(strings.ToLower(mustJSON(t, link)), "chambre-42") {
		t.Fatal("the password leaked into the API response")
	}
	var stored string
	if err := h.st.DB().QueryRow(`SELECT password_hash FROM links WHERE id = ?`,
		int64(link["id"].(float64))).Scan(&stored); err != nil {
		t.Fatalf("read hash: %v", err)
	}
	if stored == "chambre-42" {
		t.Fatal("the password was stored in the clear")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(stored), []byte("chambre-42")); err != nil {
		t.Fatalf("stored value is not a usable bcrypt hash: %v", err)
	}
}

func TestOtherShortDomainsPointAtTheInterface(t *testing.T) {
	h := setup(t)
	w := h.do(http.MethodGet, "https://clns.li/", "", false)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want a redirect to the admin host", w.Code)
	}
	if got := w.Header().Get("Location"); got != "https://go.collines.co" {
		t.Fatalf("Location = %q", got)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestLinkStillResolvesWhenTheProxyRewritesHost(t *testing.T) {
	h := setup(t)
	h.createLink(t, `{"dest":"https://collines.co/tp","slug":"proxy"}`)

	// Some reverse proxies forward Host as their own upstream address. Without
	// a fallback every link would 404, and nothing in the symptom would point
	// at the proxy configuration.
	r := httptest.NewRequest(http.MethodGet, "http://localhost:9018/proxy", nil)
	r.Host = "localhost:9018"
	r.Header.Set("X-Forwarded-For", "203.0.113.4")
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 behind a Host-rewriting proxy", w.Code)
	}
	if got := w.Header().Get("Location"); got != "https://collines.co/tp" {
		t.Fatalf("Location = %q", got)
	}
}
