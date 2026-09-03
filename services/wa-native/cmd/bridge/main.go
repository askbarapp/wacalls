package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func main() {
	addr := getenv("WHATSAPP_PORT", "4010")
	dbURL := normalizePostgresURL(mustEnv("DATABASE_URL"))
	redisURL := getenv("REDIS_URL", "redis://localhost:6379")
	token := getenv("INTERNAL_TOKEN", "")
	recordings := getenv("RECORDINGS_DIR", "/data/recordings")
	debug := getenv("LOG_LEVEL", "info") == "debug"

	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Error("postgres open failed", "err", err)
		os.Exit(1)
	}
	db.SetMaxOpenConns(20)
	defer db.Close()

	if err := ensureNativeTables(ctx, db); err != nil {
		log.Error("native tables failed", "err", err)
		os.Exit(1)
	}

	container := sqlstore.NewWithDB(db, "postgres", waLog.Noop)
	if err := container.Upgrade(ctx); err != nil {
		log.Error("whatsmeow store upgrade failed", "err", err)
		os.Exit(1)
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Error("redis url invalid", "err", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()

	waLogger := waLog.Noop
	if debug {
		waLogger = waLog.Stdout("WA", "INFO", true)
	}

	hub := NewHub(ctx, db, container, rdb, token, recordings, waLogger, log)
	if err := hub.Restore(ctx); err != nil {
		log.Warn("session restore failed", "err", err)
	}

	srv := &http.Server{
		Addr:              ":" + addr,
		Handler:           hub.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Info("native WhatsApp voice listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("http server", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	hub.Shutdown()
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("missing required env", "key", key)
		os.Exit(1)
	}
	return v
}

func normalizePostgresURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := u.Query()
	q.Del("schema")
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "disable")
	}
	u.RawQuery = q.Encode()
	return u.String()
}
