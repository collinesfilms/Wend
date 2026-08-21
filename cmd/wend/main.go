// Command wend runs the Wend link shortener: one binary that
// serves the admin interface, the API and the short links themselves.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/collinesfilms/wend/internal/auth"
	"github.com/collinesfilms/wend/internal/config"
	"github.com/collinesfilms/wend/internal/httpx"
	"github.com/collinesfilms/wend/internal/store"
)

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("wend: %v", err)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("wend: %v", err)
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := st.EnsureDomains(ctx, cfg.Domains); err != nil {
		log.Fatalf("wend: seed domains: %v", err)
	}

	// Discovery happens at startup so a wrong issuer fails here rather than at
	// somebody's first sign-in.
	secure := strings.HasPrefix(cfg.BaseURL, "https://") && !cfg.Dev
	sessions := auth.NewSessions(st, secure)
	oidc, err := auth.NewOIDC(ctx, sessions, st, cfg.OIDCIssuer, cfg.OIDCClientID, cfg.OIDCClientSecret, cfg.BaseURL)
	if err != nil {
		log.Fatalf("wend: %v", err)
	}
	go auth.SweepSessions(ctx, st)

	srv, err := httpx.New(cfg, st, sessions, oidc)
	if err != nil {
		log.Fatalf("wend: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	go func() {
		log.Printf("wend: %s", cfg)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("wend: listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Print("wend: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("wend: shutdown: %v", err)
	}
}
