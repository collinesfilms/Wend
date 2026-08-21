package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	ErrSlugTaken    = errors.New("slug already in use")
	ErrSlugInvalid  = errors.New("invalid slug")
	ErrSlugReserved = errors.New("slug is reserved")
	ErrNotFound     = errors.New("not found")
)

// Reserved slugs: everything the server itself answers at the root, so a link
// can never shadow the admin UI, its assets, or a well-known path.
var reserved = map[string]bool{
	"":                     true,
	"_":                    true,
	"api":                  true,
	"auth":                 true,
	"health":               true,
	"favicon.ico":          true,
	"robots.txt":           true,
	"manifest.webmanifest": true,
	"sw.js":                true,
	"sitemap.xml":          true,
	".well-known":          true,
	"apple-touch-icon.png": true,
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

// NormalizeSlug lowercases and validates a slug. Lookups are case-insensitive
// so a slug read off a projector still works when typed with a capital.
func NormalizeSlug(raw string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.Trim(s, "/")
	if s == "" {
		return "", ErrSlugInvalid
	}
	if reserved[s] {
		return "", ErrSlugReserved
	}
	if !slugRe.MatchString(s) {
		return "", ErrSlugInvalid
	}
	return s, nil
}

func IsReserved(slug string) bool { return reserved[strings.ToLower(slug)] }

// ---------------------------------------------------------------- domains

type Domain struct {
	ID        int64  `json:"id"`
	Host      string `json:"host"`
	IsDefault bool   `json:"is_default"`
}

// EnsureDomains inserts any domain that is configured but not yet stored, and
// guarantees exactly one default.
func (s *Store) EnsureDomains(ctx context.Context, hosts []string) error {
	for _, h := range hosts {
		h = strings.ToLower(strings.TrimSpace(h))
		if h == "" {
			continue
		}
		if _, err := s.db.ExecContext(ctx,
			`INSERT INTO domains (host, is_default, created_at) VALUES (?, 0, ?)
			 ON CONFLICT(host) DO NOTHING`, h, nowString()); err != nil {
			return err
		}
	}
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM domains WHERE is_default = 1`).Scan(&n); err != nil {
		return err
	}
	if n != 1 && len(hosts) > 0 {
		if _, err := s.db.ExecContext(ctx, `UPDATE domains SET is_default = 0`); err != nil {
			return err
		}
		_, err := s.db.ExecContext(ctx, `UPDATE domains SET is_default = 1 WHERE host = ?`, strings.ToLower(hosts[0]))
		return err
	}
	return nil
}

func (s *Store) Domains(ctx context.Context) ([]Domain, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, host, is_default FROM domains ORDER BY is_default DESC, host`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Domain{}
	for rows.Next() {
		var d Domain
		if err := rows.Scan(&d.ID, &d.Host, &d.IsDefault); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) AddDomain(ctx context.Context, host string) (Domain, error) {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" || strings.ContainsAny(host, "/ :") {
		return Domain{}, fmt.Errorf("invalid host")
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO domains (host, is_default, created_at) VALUES (?, 0, ?)`, host, nowString())
	if err != nil {
		return Domain{}, err
	}
	id, _ := res.LastInsertId()
	return Domain{ID: id, Host: host}, nil
}

func (s *Store) SetDefaultDomain(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE domains SET is_default = 0`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE domains SET is_default = 1 WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteDomain refuses to remove a domain that still has slugs on it: those
// links are in the wild and would stop resolving.
func (s *Store) DeleteDomain(ctx context.Context, id int64) error {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM slugs WHERE domain_id = ?`, id).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("%d link(s) still use this domain", n)
	}
	var isDefault bool
	if err := s.db.QueryRowContext(ctx, `SELECT is_default FROM domains WHERE id = ?`, id).Scan(&isDefault); err != nil {
		return ErrNotFound
	}
	if isDefault {
		return fmt.Errorf("this is the default domain")
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM domains WHERE id = ?`, id)
	return err
}

func (s *Store) DomainByHost(ctx context.Context, host string) (Domain, error) {
	host = strings.ToLower(host)
	if i := strings.IndexByte(host, ':'); i >= 0 { // strip any port
		host = host[:i]
	}
	var d Domain
	err := s.db.QueryRowContext(ctx,
		`SELECT id, host, is_default FROM domains WHERE host = ?`, host).Scan(&d.ID, &d.Host, &d.IsDefault)
	if errors.Is(err, sql.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

func (s *Store) DefaultDomain(ctx context.Context) (Domain, error) {
	var d Domain
	err := s.db.QueryRowContext(ctx,
		`SELECT id, host, is_default FROM domains ORDER BY is_default DESC, id LIMIT 1`).Scan(&d.ID, &d.Host, &d.IsDefault)
	if errors.Is(err, sql.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// ---------------------------------------------------------------- links

type Alias struct {
	Slug     string `json:"slug"`
	DomainID int64  `json:"domain_id"`
	Host     string `json:"host"`
}

type Link struct {
	ID          int64      `json:"id"`
	Slug        string     `json:"slug"`
	DomainID    int64      `json:"domain_id"`
	Host        string     `json:"host"`
	ShortURL    string     `json:"short_url"`
	Dest        string     `json:"dest"`
	HasPassword bool       `json:"has_password"`
	ExpiresAt   *time.Time `json:"expires_at"`
	Disabled    bool       `json:"disabled"`
	Expired     bool       `json:"expired"`
	OwnerID     string     `json:"owner_id"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	LastClickAt *time.Time `json:"last_click_at"`
	Aliases     []Alias    `json:"aliases"`
	Clicks      int        `json:"clicks"`
	Uniques     int        `json:"uniques"`
	Series      []int      `json:"series"`
}

const linkColumns = `l.id, l.dest, l.password_hash, l.expires_at, l.disabled, l.owner_id,
	l.created_at, l.updated_at, l.last_click_at,
	s.slug, s.domain_id, d.host`

func scanLink(sc interface{ Scan(...any) error }) (Link, error) {
	var (
		l         Link
		pwHash    string
		expires   sql.NullString
		created   string
		updated   string
		lastClick sql.NullString
	)
	if err := sc.Scan(&l.ID, &l.Dest, &pwHash, &expires, &l.Disabled, &l.OwnerID,
		&created, &updated, &lastClick, &l.Slug, &l.DomainID, &l.Host); err != nil {
		return l, err
	}
	l.HasPassword = pwHash != ""
	l.CreatedAt, _ = time.Parse(time.RFC3339, created)
	l.UpdatedAt, _ = time.Parse(time.RFC3339, updated)
	if expires.Valid {
		if t, err := time.Parse(time.RFC3339, expires.String); err == nil {
			l.ExpiresAt = &t
			l.Expired = t.Before(time.Now().UTC())
		}
	}
	if lastClick.Valid {
		if t, err := time.Parse(time.RFC3339, lastClick.String); err == nil {
			l.LastClickAt = &t
		}
	}
	l.ShortURL = "https://" + l.Host + "/" + l.Slug
	l.Aliases = []Alias{}
	l.Series = []int{}
	return l, nil
}

type CreateLink struct {
	Dest         string
	Slug         string // empty means "generate one"
	DomainID     int64
	PasswordHash string
	ExpiresAt    *time.Time
	OwnerID      string
}

// Create claims the slug and the link in one transaction, so a race between
// two tabs can never hand the same slug to two destinations.
func (s *Store) Create(ctx context.Context, in CreateLink) (Link, error) {
	slug, err := NormalizeSlug(in.Slug)
	if err != nil {
		return Link{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Link{}, err
	}
	defer tx.Rollback()

	var taken int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM slugs WHERE domain_id = ? AND slug = ?`, in.DomainID, slug).Scan(&taken); err != nil {
		return Link{}, err
	}
	if taken > 0 {
		return Link{}, ErrSlugTaken
	}

	now := nowString()
	var expires any
	if in.ExpiresAt != nil {
		expires = in.ExpiresAt.UTC().Format(time.RFC3339)
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO links (dest, password_hash, expires_at, disabled, owner_id, created_at, updated_at)
		 VALUES (?, ?, ?, 0, ?, ?, ?)`,
		in.Dest, in.PasswordHash, expires, in.OwnerID, now, now)
	if err != nil {
		return Link{}, err
	}
	id, _ := res.LastInsertId()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO slugs (domain_id, slug, link_id, is_primary, created_at) VALUES (?, ?, ?, 1, ?)`,
		in.DomainID, slug, id, now); err != nil {
		return Link{}, err
	}
	if err := tx.Commit(); err != nil {
		return Link{}, err
	}
	return s.Link(ctx, id)
}

// SlugAvailable reports whether a slug can still be claimed on a domain.
func (s *Store) SlugAvailable(ctx context.Context, domainID int64, raw string) (bool, error) {
	slug, err := NormalizeSlug(raw)
	if err != nil {
		return false, err
	}
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM slugs WHERE domain_id = ? AND slug = ?`, domainID, slug).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

func (s *Store) AddAlias(ctx context.Context, linkID, domainID int64, raw string) error {
	slug, err := NormalizeSlug(raw)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO slugs (domain_id, slug, link_id, is_primary, created_at) VALUES (?, ?, ?, 0, ?)`,
		domainID, slug, linkID, nowString())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrSlugTaken
	}
	return err
}

func (s *Store) Link(ctx context.Context, id int64) (Link, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+linkColumns+`
		 FROM links l
		 JOIN slugs s ON s.link_id = l.id AND s.is_primary = 1
		 JOIN domains d ON d.id = s.domain_id
		 WHERE l.id = ? AND l.deleted_at IS NULL`, id)
	l, err := scanLink(row)
	if errors.Is(err, sql.ErrNoRows) {
		return l, ErrNotFound
	}
	if err != nil {
		return l, err
	}
	if err := s.decorate(ctx, &l); err != nil {
		return l, err
	}
	return l, nil
}

// List returns every live link for an owner, newest first, with its stats.
func (s *Store) List(ctx context.Context, ownerID string) ([]Link, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+linkColumns+`
		 FROM links l
		 JOIN slugs s ON s.link_id = l.id AND s.is_primary = 1
		 JOIN domains d ON d.id = s.domain_id
		 WHERE l.owner_id = ? AND l.deleted_at IS NULL
		 ORDER BY l.created_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Link{}
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if err := s.decorate(ctx, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// decorate fills in the aliases and the click stats for a link.
func (s *Store) decorate(ctx context.Context, l *Link) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.slug, s.domain_id, d.host FROM slugs s
		 JOIN domains d ON d.id = s.domain_id
		 WHERE s.link_id = ? AND s.is_primary = 0 ORDER BY s.created_at`, l.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var a Alias
		if err := rows.Scan(&a.Slug, &a.DomainID, &a.Host); err != nil {
			rows.Close()
			return err
		}
		l.Aliases = append(l.Aliases, a)
	}
	rows.Close()

	var total, uniq sql.NullInt64
	if err := s.db.QueryRowContext(ctx,
		`SELECT SUM(total), SUM(uniques) FROM clicks WHERE link_id = ?`, l.ID).Scan(&total, &uniq); err != nil {
		return err
	}
	l.Clicks, l.Uniques = int(total.Int64), int(uniq.Int64)

	// last seven days, oldest first, zero-filled
	series := make([]int, 7)
	byDay := map[string]int{}
	dayRows, err := s.db.QueryContext(ctx,
		`SELECT day, total FROM clicks WHERE link_id = ? AND day >= ?`,
		l.ID, time.Now().UTC().AddDate(0, 0, -6).Format("2006-01-02"))
	if err != nil {
		return err
	}
	for dayRows.Next() {
		var day string
		var n int
		if err := dayRows.Scan(&day, &n); err != nil {
			dayRows.Close()
			return err
		}
		byDay[day] = n
	}
	dayRows.Close()
	for i := 0; i < 7; i++ {
		day := time.Now().UTC().AddDate(0, 0, i-6).Format("2006-01-02")
		series[i] = byDay[day]
	}
	l.Series = series
	return nil
}

type UpdateLink struct {
	Dest         *string
	PasswordHash *string // empty string clears the password
	ExpiresAt    **time.Time
	Disabled     *bool
}

func (s *Store) Update(ctx context.Context, id int64, ownerID string, in UpdateLink) error {
	sets := []string{"updated_at = ?"}
	args := []any{nowString()}
	if in.Dest != nil {
		sets = append(sets, "dest = ?")
		args = append(args, *in.Dest)
	}
	if in.PasswordHash != nil {
		sets = append(sets, "password_hash = ?")
		args = append(args, *in.PasswordHash)
	}
	if in.ExpiresAt != nil {
		sets = append(sets, "expires_at = ?")
		if *in.ExpiresAt == nil {
			args = append(args, nil)
		} else {
			args = append(args, (*in.ExpiresAt).UTC().Format(time.RFC3339))
		}
	}
	if in.Disabled != nil {
		sets = append(sets, "disabled = ?")
		args = append(args, *in.Disabled)
	}
	args = append(args, id, ownerID)
	res, err := s.db.ExecContext(ctx,
		`UPDATE links SET `+strings.Join(sets, ", ")+
			` WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete is a soft delete that keeps the slug rows, so the slug is retired
// rather than freed: a link handed out last term never points somewhere new.
func (s *Store) Delete(ctx context.Context, id int64, ownerID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`UPDATE links SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
		nowString(), nowString(), id, ownerID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `UPDATE slugs SET link_id = NULL WHERE link_id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------------------------------------------------------------- resolution

type Target struct {
	LinkID       int64
	Dest         string
	PasswordHash string
	ExpiresAt    *time.Time
	Disabled     bool
}

// Resolve looks up a slug on a host. It is the hot path: one indexed query.
func (s *Store) Resolve(ctx context.Context, host, slug string) (Target, error) {
	host = strings.ToLower(host)
	if i := strings.IndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	slug = strings.ToLower(strings.Trim(slug, "/"))

	var (
		t       Target
		expires sql.NullString
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT l.id, l.dest, l.password_hash, l.expires_at, l.disabled
		 FROM slugs s
		 JOIN domains d ON d.id = s.domain_id
		 JOIN links l ON l.id = s.link_id
		 WHERE d.host = ? AND s.slug = ? AND l.deleted_at IS NULL`,
		host, slug).Scan(&t.LinkID, &t.Dest, &t.PasswordHash, &expires, &t.Disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	if err != nil {
		return t, err
	}
	if expires.Valid {
		if tt, err := time.Parse(time.RFC3339, expires.String); err == nil {
			t.ExpiresAt = &tt
		}
	}
	return t, nil
}

// RecordClick bumps the daily counters. visitor is a salted hash; an empty
// string counts the open without attempting to de-duplicate it.
func (s *Store) RecordClick(ctx context.Context, linkID int64, visitor string) error {
	day := time.Now().UTC().Format("2006-01-02")
	unique := 0
	if visitor != "" {
		res, err := s.db.ExecContext(ctx,
			`INSERT INTO click_seen (link_id, day, visitor) VALUES (?, ?, ?)
			 ON CONFLICT DO NOTHING`, linkID, day, visitor)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			unique = 1
		}
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO clicks (link_id, day, total, uniques) VALUES (?, ?, 1, ?)
		 ON CONFLICT(link_id, day) DO UPDATE SET
		   total = total + 1, uniques = uniques + excluded.uniques`,
		linkID, day, unique); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE links SET last_click_at = ? WHERE id = ?`, nowString(), linkID)
	return err
}
