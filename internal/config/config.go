// Package config reads the runtime configuration from the environment.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Listen     string   // address to bind, e.g. ":8080"
	DBPath     string   // SQLite file
	BaseURL    string   // where the admin UI is served, e.g. https://go.collines.co
	Domains    []string // short domains, first one is the default
	SessionKey []byte   // 32 bytes, signs session cookies

	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string

	TrustProxy bool // read the client IP from X-Forwarded-For
	Dev        bool // relax cookie security, serve the Vite dev proxy
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// Load reads the configuration and validates the parts the server cannot run
// without. It returns every problem at once rather than one per restart.
func Load() (*Config, error) {
	c := &Config{
		Listen:           env("CG_LISTEN", ":8080"),
		DBPath:           env("CG_DB_PATH", "/data/collinesgo.db"),
		BaseURL:          strings.TrimRight(env("CG_BASE_URL", ""), "/"),
		OIDCIssuer:       strings.TrimRight(env("CG_OIDC_ISSUER", ""), "/"),
		OIDCClientID:     env("CG_OIDC_CLIENT_ID", ""),
		OIDCClientSecret: env("CG_OIDC_CLIENT_SECRET", ""),
		TrustProxy:       envBool("CG_TRUST_PROXY", true),
		Dev:              envBool("CG_DEV", false),
	}

	for _, d := range strings.Split(env("CG_SHORT_DOMAINS", ""), ",") {
		if d = strings.TrimSpace(strings.ToLower(d)); d != "" {
			c.Domains = append(c.Domains, d)
		}
	}

	var problems []string
	if c.BaseURL == "" {
		problems = append(problems, "CG_BASE_URL is required (e.g. https://go.collines.co)")
	}
	if c.OIDCIssuer == "" {
		problems = append(problems, "CG_OIDC_ISSUER is required (your PocketID URL)")
	}
	if c.OIDCClientID == "" {
		problems = append(problems, "CG_OIDC_CLIENT_ID is required")
	}
	if c.OIDCClientSecret == "" {
		problems = append(problems, "CG_OIDC_CLIENT_SECRET is required")
	}

	key := env("CG_SESSION_KEY", "")
	switch {
	case key == "":
		problems = append(problems,
			"CG_SESSION_KEY is required: 32+ random characters, "+
				"otherwise everyone is signed out on every restart")
	case len(key) < 32:
		problems = append(problems, "CG_SESSION_KEY must be at least 32 characters")
	default:
		c.SessionKey = []byte(key)
	}

	// The admin host also serves short links, so it is always a known domain.
	if host := hostOf(c.BaseURL); host != "" && !contains(c.Domains, host) {
		c.Domains = append(c.Domains, host)
	}
	if len(c.Domains) == 0 {
		problems = append(problems, "no short domain: set CG_SHORT_DOMAINS or a valid CG_BASE_URL")
	}

	if len(problems) > 0 {
		return nil, errors.New("configuration:\n  - " + strings.Join(problems, "\n  - "))
	}
	return c, nil
}

func hostOf(rawURL string) string {
	s := rawURL
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	s = strings.TrimSuffix(s, "/")
	if i := strings.IndexAny(s, "/:"); i >= 0 {
		s = s[:i]
	}
	return strings.ToLower(s)
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func (c *Config) String() string {
	return fmt.Sprintf("listen=%s db=%s base=%s domains=%s issuer=%s",
		c.Listen, c.DBPath, c.BaseURL, strings.Join(c.Domains, ","), c.OIDCIssuer)
}
