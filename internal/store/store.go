// Package store owns the SQLite database: schema, queries and the small
// amount of bookkeeping (salt rotation, expiry sweeps) that goes with it.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

type Store struct{ db *sql.DB }

// Open creates the database file if needed and applies the schema.
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create data directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// SQLite takes one writer at a time; more connections only add lock churn.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		// Bind-mounting a host directory that the container user cannot write
		// is the usual cause, and the driver's own message does not say so.
		return nil, fmt.Errorf(
			"impossible d'ouvrir la base %s : %w\n"+
				"Si le dossier est monté depuis l'hôte, il doit appartenir à "+
				"l'utilisateur du conteneur : chown -R 10001:10001 <dossier>",
			path, err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) DB() *sql.DB  { return s.db }

// ---------------------------------------------------------------- settings

func (s *Store) Setting(ctx context.Context, key, def string) string {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err != nil {
		return def
	}
	return v
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// VisitorSalt returns today's salt, generating a fresh one when the day turns
// and dropping the previous day's so old hashes can never be recomputed.
func (s *Store) VisitorSalt(ctx context.Context) (string, error) {
	today := time.Now().UTC().Format("2006-01-02")
	if day := s.Setting(ctx, "salt_day", ""); day == today {
		if salt := s.Setting(ctx, "salt_value", ""); salt != "" {
			return salt, nil
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	salt := hex.EncodeToString(buf)
	if err := s.SetSetting(ctx, "salt_value", salt); err != nil {
		return "", err
	}
	if err := s.SetSetting(ctx, "salt_day", today); err != nil {
		return "", err
	}
	// Yesterday's visitor rows can no longer be matched; keep only what the
	// current day needs for de-duplication.
	_, _ = s.db.ExecContext(ctx, `DELETE FROM click_seen WHERE day < ?`, today)
	return salt, nil
}

// ---------------------------------------------------------------- users

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (s *Store) UpsertUser(ctx context.Context, u User) error {
	now := nowString()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, name, created_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   email = excluded.email, name = excluded.name, last_seen_at = excluded.last_seen_at`,
		u.ID, u.Email, u.Name, now, now)
	return err
}

func (s *Store) User(ctx context.Context, id string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, name FROM users WHERE id = ?`, id).Scan(&u.ID, &u.Email, &u.Name)
	return u, err
}

func nowString() string { return time.Now().UTC().Format(time.RFC3339) }
