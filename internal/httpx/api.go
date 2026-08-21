package httpx

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/collinesfilms/wend/internal/auth"
	"github.com/collinesfilms/wend/internal/store"
)

// Ambiguous characters are left out so a code read off a projector and typed
// by hand does not turn into a different link.
const slugAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

func randomSlug(n int) (string, error) {
	b := make([]byte, n)
	max := big.NewInt(int64(len(slugAlphabet)))
	for i := range b {
		k, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b[i] = slugAlphabet[k.Int64()]
	}
	return string(b), nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil && id > 0
}

// validDest keeps the shortener from being pointed at javascript: or data:
// URLs, which would turn every short link into an XSS vector.
func validDest(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}
	return u.String(), true
}

// ---------------------------------------------------------------- settings

type appSettings struct {
	SlugLength    int    `json:"slug_length"`
	DefaultExpiry string `json:"default_expiry"`
	AutoCopy      bool   `json:"auto_copy"`
	AutoPaste     bool   `json:"auto_paste"`
}

func (s *Server) settings(r *http.Request) appSettings {
	ctx := r.Context()
	n, err := strconv.Atoi(s.st.Setting(ctx, "slug_length", "5"))
	if err != nil || n < 4 || n > 12 {
		n = 5
	}
	return appSettings{
		SlugLength:    n,
		DefaultExpiry: s.st.Setting(ctx, "default_expiry", "never"),
		AutoCopy:      s.st.Setting(ctx, "auto_copy", "1") == "1",
		AutoPaste:     s.st.Setting(ctx, "auto_paste", "1") == "1",
	}
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.settings(r))
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var in appSettings
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "could not read that request")
		return
	}
	if in.SlugLength < 4 || in.SlugLength > 12 {
		writeErr(w, http.StatusBadRequest, "code length must be between 4 and 12")
		return
	}
	switch in.DefaultExpiry {
	case "never", "1h", "today", "7d", "30d":
	default:
		writeErr(w, http.StatusBadRequest, "unknown default expiry")
		return
	}
	ctx := r.Context()
	_ = s.st.SetSetting(ctx, "slug_length", strconv.Itoa(in.SlugLength))
	_ = s.st.SetSetting(ctx, "default_expiry", in.DefaultExpiry)
	_ = s.st.SetSetting(ctx, "auto_copy", boolStr(in.AutoCopy))
	_ = s.st.SetSetting(ctx, "auto_paste", boolStr(in.AutoPaste))
	writeJSON(w, http.StatusOK, s.settings(r))
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// ---------------------------------------------------------------- me

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	domains, err := s.st.Domains(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load the domains")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":     u,
		"domains":  domains,
		"settings": s.settings(r),
		"brand": map[string]string{
			"name":    s.cfg.BrandName,
			"tagline": s.cfg.Tagline,
		},
	})
}

// ---------------------------------------------------------------- domains

func (s *Server) handleAddDomain(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Host string `json:"host"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "could not read that request")
		return
	}
	host := strings.ToLower(strings.TrimSpace(in.Host))
	host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
	host = strings.Trim(host, "/")
	if host == "" || !strings.Contains(host, ".") || strings.ContainsAny(host, " /:?#") {
		writeErr(w, http.StatusBadRequest, "that domain is not valid")
		return
	}
	d, err := s.st.AddDomain(r.Context(), host)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, http.StatusConflict, "that domain is already registered")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not add the domain")
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) handleDefaultDomain(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid identifier")
		return
	}
	if err := s.st.SetDefaultDomain(r.Context(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not change the default domain")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteDomain(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid identifier")
		return
	}
	if err := s.st.DeleteDomain(r.Context(), id); err != nil {
		writeErr(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------- links

func (s *Server) handleListLinks(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	links, err := s.st.List(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load the links")
		return
	}
	writeJSON(w, http.StatusOK, links)
}

func (s *Server) handleCheckSlug(w http.ResponseWriter, r *http.Request) {
	domainID, err := strconv.ParseInt(r.URL.Query().Get("domain_id"), 10, 64)
	if err != nil {
		d, err := s.st.DefaultDomain(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "no domain configured")
			return
		}
		domainID = d.ID
	}
	raw := r.URL.Query().Get("slug")
	available, err := s.st.SlugAvailable(r.Context(), domainID, raw)
	switch {
	case errors.Is(err, store.ErrSlugReserved):
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "reason": "reserved"})
	case errors.Is(err, store.ErrSlugInvalid):
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "reason": "invalid"})
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not check that slug")
	default:
		reason := ""
		if !available {
			reason = "taken"
		}
		writeJSON(w, http.StatusOK, map[string]any{"available": available, "reason": reason})
	}
}

// handleFindByDest answers "have I already shortened this?" so the interface
// can offer the existing link instead of quietly making a second one.
func (s *Server) handleFindByDest(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	dest, ok := validDest(r.URL.Query().Get("dest"))
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"link": nil})
		return
	}
	links, err := s.st.List(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not look that up")
		return
	}
	for i := range links {
		if links[i].Dest == dest && !links[i].Expired && !links[i].Disabled {
			writeJSON(w, http.StatusOK, map[string]any{"link": links[i]})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"link": nil})
}

type createLinkRequest struct {
	Dest      string  `json:"dest"`
	Slug      string  `json:"slug"`
	DomainID  int64   `json:"domain_id"`
	Password  string  `json:"password"`
	ExpiresAt *string `json:"expires_at"`
}

func (s *Server) handleCreateLink(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	var in createLinkRequest
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "could not read that request")
		return
	}
	dest, ok := validDest(in.Dest)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid destination: an http or https address is expected")
		return
	}

	domainID := in.DomainID
	if domainID == 0 {
		d, err := s.st.DefaultDomain(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "no domain configured")
			return
		}
		domainID = d.ID
	}

	expires, err := parseExpiry(in.ExpiresAt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid expiry date")
		return
	}

	hash := ""
	if in.Password != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not protect the link")
			return
		}
		hash = string(h)
	}

	create := store.CreateLink{
		Dest: dest, Slug: in.Slug, DomainID: domainID,
		PasswordHash: hash, ExpiresAt: expires, OwnerID: u.ID,
	}

	// An explicit slug is used as given; an empty one is generated, retrying
	// on the rare collision and widening the code if the space gets crowded.
	if strings.TrimSpace(in.Slug) == "" {
		length := s.settings(r).SlugLength
		var link store.Link
		for attempt := 0; attempt < 12; attempt++ {
			slug, err := randomSlug(length + attempt/4)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not generate a code")
				return
			}
			create.Slug = slug
			link, err = s.st.Create(r.Context(), create)
			if errors.Is(err, store.ErrSlugTaken) {
				continue
			}
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not create the link")
				return
			}
			writeJSON(w, http.StatusCreated, link)
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not find a free code")
		return
	}

	link, err := s.st.Create(r.Context(), create)
	switch {
	case errors.Is(err, store.ErrSlugTaken):
		writeErr(w, http.StatusConflict, "that slug is already in use")
	case errors.Is(err, store.ErrSlugReserved):
		writeErr(w, http.StatusConflict, "that slug is reserved")
	case errors.Is(err, store.ErrSlugInvalid):
		writeErr(w, http.StatusBadRequest, "invalid slug")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not create the link")
	default:
		writeJSON(w, http.StatusCreated, link)
	}
}

func parseExpiry(raw *string) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *raw)
	if err != nil {
		return nil, err
	}
	u := t.UTC()
	return &u, nil
}

func (s *Server) handleGetLink(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid identifier")
		return
	}
	link, err := s.st.Link(r.Context(), id)
	if err != nil || link.OwnerID != u.ID {
		writeErr(w, http.StatusNotFound, "link not found")
		return
	}
	writeJSON(w, http.StatusOK, link)
}

type updateLinkRequest struct {
	Dest      *string `json:"dest"`
	Password  *string `json:"password"`   // "" clears it
	ExpiresAt *string `json:"expires_at"` // "" clears it
	Disabled  *bool   `json:"disabled"`
}

func (s *Server) handleUpdateLink(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid identifier")
		return
	}
	var in updateLinkRequest
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "could not read that request")
		return
	}

	var upd store.UpdateLink
	if in.Dest != nil {
		dest, ok := validDest(*in.Dest)
		if !ok {
			writeErr(w, http.StatusBadRequest, "invalid destination")
			return
		}
		upd.Dest = &dest
	}
	if in.Password != nil {
		hash := ""
		if *in.Password != "" {
			h, err := bcrypt.GenerateFromPassword([]byte(*in.Password), bcrypt.DefaultCost)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not protect the link")
				return
			}
			hash = string(h)
		}
		upd.PasswordHash = &hash
	}
	if in.ExpiresAt != nil {
		if strings.TrimSpace(*in.ExpiresAt) == "" {
			var none *time.Time
			upd.ExpiresAt = &none
		} else {
			t, err := parseExpiry(in.ExpiresAt)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "invalid expiry date")
				return
			}
			upd.ExpiresAt = &t
		}
	}
	upd.Disabled = in.Disabled

	if err := s.st.Update(r.Context(), id, u.ID, upd); err != nil {
		writeErr(w, http.StatusNotFound, "link not found")
		return
	}
	link, err := s.st.Link(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load the link")
		return
	}
	writeJSON(w, http.StatusOK, link)
}

func (s *Server) handleDeleteLink(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid identifier")
		return
	}
	if err := s.st.Delete(r.Context(), id, u.ID); err != nil {
		writeErr(w, http.StatusNotFound, "link not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAddAlias(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, ok := pathID(r, "id")
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid identifier")
		return
	}
	link, err := s.st.Link(r.Context(), id)
	if err != nil || link.OwnerID != u.ID {
		writeErr(w, http.StatusNotFound, "link not found")
		return
	}
	var in struct {
		Slug     string `json:"slug"`
		DomainID int64  `json:"domain_id"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "could not read that request")
		return
	}
	domainID := in.DomainID
	if domainID == 0 {
		domainID = link.DomainID
	}
	switch err := s.st.AddAlias(r.Context(), id, domainID, in.Slug); {
	case errors.Is(err, store.ErrSlugTaken):
		writeErr(w, http.StatusConflict, "that slug is already in use")
	case errors.Is(err, store.ErrSlugReserved):
		writeErr(w, http.StatusConflict, "that slug is reserved")
	case errors.Is(err, store.ErrSlugInvalid):
		writeErr(w, http.StatusBadRequest, "invalid slug")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not add that")
	default:
		updated, _ := s.st.Link(r.Context(), id)
		writeJSON(w, http.StatusCreated, updated)
	}
}
