// Package auth signs users in through PocketID (OIDC) and keeps their session.
//
// Authorisation is delegated entirely to the provider: there is no user
// database to manage here. If PocketID completes a login for this client, the
// person is allowed in, and revoking their access there revokes it here.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/collinesfilms/shortify/internal/store"
)

const (
	sessionCookie = "cg_session"
	stateCookie   = "cg_state"
	pkceCookie    = "cg_pkce"
	sessionTTL    = 30 * 24 * time.Hour
)

// Sessions owns everything that does not need the identity provider: issuing,
// reading and revoking a session. Splitting it out keeps the request path (and
// its tests) independent of any network round trip to PocketID.
type Sessions struct {
	st     *store.Store
	secure bool
}

func NewSessions(st *store.Store, secure bool) *Sessions {
	return &Sessions{st: st, secure: secure}
}

// OIDC drives the sign-in flow itself.
type OIDC struct {
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
	sessions *Sessions
	st       *store.Store
}

type ctxKey struct{}

// NewOIDC performs discovery against the issuer. It runs at startup so a
// misconfigured issuer fails loudly rather than at somebody's first sign-in.
func NewOIDC(ctx context.Context, sessions *Sessions, st *store.Store, issuer, clientID, clientSecret, baseURL string) (*OIDC, error) {
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider at %s: %w", issuer, err)
	}
	return &OIDC{
		provider: provider,
		verifier: provider.Verifier(&oidc.Config{ClientID: clientID}),
		oauth: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  strings.TrimRight(baseURL, "/") + "/auth/callback",
			Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
		},
		sessions: sessions,
		st:       st,
	}, nil
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func (a *Sessions) cookie(name, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   a.secure,
		SameSite: http.SameSiteLaxMode,
	}
}

// Login starts the authorisation-code flow with PKCE.
func (a *OIDC) Login(w http.ResponseWriter, r *http.Request) {
	state, err := randomToken()
	if err != nil {
		http.Error(w, "could not start sign-in", http.StatusInternalServerError)
		return
	}
	verifier := oauth2.GenerateVerifier()

	http.SetCookie(w, a.sessions.cookie(stateCookie, state, 600))
	http.SetCookie(w, a.sessions.cookie(pkceCookie, verifier, 600))
	http.Redirect(w, r, a.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

// Callback completes the flow and issues a session.
func (a *OIDC) Callback(w http.ResponseWriter, r *http.Request) {
	if e := r.URL.Query().Get("error"); e != "" {
		a.fail(w, r, "Your identity provider refused the sign-in ("+e+").")
		return
	}
	stateC, err := r.Cookie(stateCookie)
	if err != nil || stateC.Value == "" || stateC.Value != r.URL.Query().Get("state") {
		a.fail(w, r, "That sign-in request expired. Try again.")
		return
	}
	pkceC, err := r.Cookie(pkceCookie)
	if err != nil {
		a.fail(w, r, "That sign-in request expired. Try again.")
		return
	}
	http.SetCookie(w, a.sessions.cookie(stateCookie, "", -1))
	http.SetCookie(w, a.sessions.cookie(pkceCookie, "", -1))

	tok, err := a.oauth.Exchange(r.Context(), r.URL.Query().Get("code"),
		oauth2.VerifierOption(pkceC.Value))
	if err != nil {
		a.fail(w, r, "Could not exchange the authorization code.")
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok {
		a.fail(w, r, "The provider returned no identity token.")
		return
	}
	idToken, err := a.verifier.Verify(r.Context(), rawID)
	if err != nil {
		a.fail(w, r, "That identity token is not valid.")
		return
	}
	var claims struct {
		Email             string `json:"email"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
	}
	_ = idToken.Claims(&claims)

	name := claims.Name
	if name == "" {
		name = claims.PreferredUsername
	}
	if name == "" {
		name = claims.Email
	}
	user := store.User{ID: idToken.Subject, Email: claims.Email, Name: name}
	if err := a.st.UpsertUser(r.Context(), user); err != nil {
		a.fail(w, r, "Could not record the account.")
		return
	}

	if err := a.sessions.Issue(r.Context(), w, user.ID); err != nil {
		a.fail(w, r, "Could not create the session.")
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (a *OIDC) fail(w http.ResponseWriter, r *http.Request, msg string) {
	http.Redirect(w, r, "/?auth_error="+strings.ReplaceAll(msg, " ", "+"), http.StatusFound)
}

// Logout drops the session on both ends.
func (a *Sessions) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		_, _ = a.st.DB().ExecContext(r.Context(), `DELETE FROM sessions WHERE id = ?`, hashToken(c.Value))
	}
	http.SetCookie(w, a.cookie(sessionCookie, "", -1))
	w.WriteHeader(http.StatusNoContent)
}

// Issue creates a session and sets its cookie.
func (a *Sessions) Issue(ctx context.Context, w http.ResponseWriter, userID string) error {
	token, err := randomToken()
	if err != nil {
		return err
	}
	if _, err := a.st.DB().ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		hashToken(token), userID,
		time.Now().UTC().Format(time.RFC3339),
		time.Now().UTC().Add(sessionTTL).Format(time.RFC3339)); err != nil {
		return err
	}
	http.SetCookie(w, a.cookie(sessionCookie, token, int(sessionTTL.Seconds())))
	return nil
}

// UserFrom returns the signed-in user attached to the request, if any.
func UserFrom(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(ctxKey{}).(store.User)
	return u, ok
}

var errNoSession = errors.New("no session")

func (a *Sessions) userForRequest(r *http.Request) (store.User, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return store.User{}, errNoSession
	}
	var userID, expires string
	err = a.st.DB().QueryRowContext(r.Context(),
		`SELECT user_id, expires_at FROM sessions WHERE id = ?`, hashToken(c.Value)).Scan(&userID, &expires)
	if err != nil {
		return store.User{}, errNoSession
	}
	if t, err := time.Parse(time.RFC3339, expires); err != nil || t.Before(time.Now().UTC()) {
		_, _ = a.st.DB().ExecContext(r.Context(), `DELETE FROM sessions WHERE id = ?`, hashToken(c.Value))
		return store.User{}, errNoSession
	}
	return a.st.User(r.Context(), userID)
}

// Attach puts the signed-in user on the context when there is one, without
// requiring it. Used for the app shell, which renders either way.
func (a *Sessions) Attach(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, err := a.userForRequest(r); err == nil {
			r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
		}
		next.ServeHTTP(w, r)
	})
}

// Require rejects anonymous callers. Used for every /api route.
func (a *Sessions) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := a.userForRequest(r)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"not signed in"}`))
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

// SweepSessions removes expired rows. Cheap, so it runs on a plain ticker.
func SweepSessions(ctx context.Context, st *store.Store) {
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, _ = st.DB().ExecContext(ctx,
				`DELETE FROM sessions WHERE expires_at < ?`, time.Now().UTC().Format(time.RFC3339))
		}
	}
}
