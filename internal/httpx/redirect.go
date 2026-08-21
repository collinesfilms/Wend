package httpx

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/collinesfilms/wend/internal/store"
	"github.com/collinesfilms/wend/locales"
)

// Password attempts are rate limited per client and slug so a protected link
// is not a free guessing oracle.
type attemptLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newAttemptLimiter() *attemptLimiter {
	l := &attemptLimiter{hits: map[string][]time.Time{}}
	go l.sweep()
	return l
}

func (l *attemptLimiter) sweep() {
	for range time.Tick(5 * time.Minute) {
		cutoff := time.Now().Add(-time.Minute)
		l.mu.Lock()
		for k, times := range l.hits {
			kept := times[:0]
			for _, t := range times {
				if t.After(cutoff) {
					kept = append(kept, t)
				}
			}
			if len(kept) == 0 {
				delete(l.hits, k)
			} else {
				l.hits[k] = kept
			}
		}
		l.mu.Unlock()
	}
}

// allow reports whether another attempt may be made: 8 per minute per key.
func (l *attemptLimiter) allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	l.mu.Lock()
	defer l.mu.Unlock()
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= 8 {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			if i := strings.IndexByte(v, ','); i >= 0 {
				v = v[:i]
			}
			return strings.TrimSpace(v)
		}
		if v := r.Header.Get("X-Real-IP"); v != "" {
			return strings.TrimSpace(v)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// visitorHash produces today's unrecoverable identifier for a visitor. The
// salt rotates daily and the previous one is discarded, so this can never be
// turned back into an address or followed from one day to the next.
func (s *Server) visitorHash(r *http.Request) string {
	salt, err := s.st.VisitorSalt(r.Context())
	if err != nil {
		return ""
	}
	sum := sha256.Sum256([]byte(salt + "|" + s.clientIP(r) + "|" + r.UserAgent()))
	return hex.EncodeToString(sum[:16])
}

func (s *Server) shortURL(r *http.Request, slug string) string {
	return "https://" + hostOnly(r.Host) + "/" + slug
}

// longDate spells a date out the way the deployment's language does. Go's
// time package only knows English month names, so they come from the catalogue.
func (s *Server) longDate(t time.Time) string {
	month := locales.Month(s.cfg.Lang, int(t.Month()))
	if month == "" {
		return t.Format("2 January 2006")
	}
	return fmt.Sprintf("%d %s %d", t.Day(), month, t.Year())
}

func hostOnly(host string) string {
	if i := strings.IndexByte(host, ':'); i >= 0 {
		return strings.ToLower(host[:i])
	}
	return strings.ToLower(host)
}

// serveSlug is the hot path. Everything here is one indexed lookup plus a
// counter write that never blocks the response.
func (s *Server) serveSlug(w http.ResponseWriter, r *http.Request) {
	slug := strings.Trim(r.URL.Path, "/")
	short := s.shortURL(r, slug)

	target, err := s.st.Resolve(r.Context(), r.Host, slug)
	if errors.Is(err, store.ErrNotFound) {
		s.notFoundPage(w, short)
		return
	}
	if err != nil {
		http.Error(w, locales.Error(s.cfg.Lang, "internal error"), http.StatusInternalServerError)
		return
	}
	if target.Disabled {
		s.expiredPage(w, short, "")
		return
	}
	if target.ExpiresAt != nil && target.ExpiresAt.Before(time.Now().UTC()) {
		s.expiredPage(w, short, s.longDate(target.ExpiresAt.Local()))
		return
	}

	if target.PasswordHash != "" {
		if r.Method != http.MethodPost {
			s.gatePage(w, short, false)
			return
		}
		key := s.clientIP(r) + "|" + slug
		if !s.limiter.allow(key) {
			s.tooManyPage(w, short)
			return
		}
		if err := bcrypt.CompareHashAndPassword(
			[]byte(target.PasswordHash), []byte(r.FormValue("password"))); err != nil {
			s.gatePage(w, short, true)
			return
		}
	} else if r.Method == http.MethodPost {
		// Nothing to submit to on an open link.
		http.Redirect(w, r, r.URL.Path, http.StatusSeeOther)
		return
	}

	s.countClick(r, target.LinkID)

	// 302 and no-store, always. A 301 would be cached by browsers and proxies
	// for good, and reviving or re-pointing the link would silently fail for
	// everyone who had already opened it.
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	http.Redirect(w, r, target.Dest, http.StatusFound)
}

// countClick records the open without making the visitor wait for it.
func (s *Server) countClick(r *http.Request, linkID int64) {
	visitor := s.visitorHash(r)
	go func() {
		ctx, cancel := contextWithTimeout(5 * time.Second)
		defer cancel()
		_ = s.st.RecordClick(ctx, linkID, visitor)
	}()
}
