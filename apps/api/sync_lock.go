package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/binary"
	"sync"
	"time"
)

// Session advisory locks belong to a physical PostgreSQL connection. Reserve
// that connection until release, so pooled callers cannot re-enter our lock.
func acquireSyncLock(ctx context.Context, pool *sql.DB, sessionID string) (func(), bool, error) {
	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	hash := sha256.Sum256([]byte("prdesk:sync:" + sessionID))
	key := int64(binary.BigEndian.Uint64(hash[:8]))
	var acquired bool
	err = conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&acquired)
	if err != nil {
		// A cancelled query can have acquired the lock before its response was
		// lost. Never return that potentially locked connection to the pool.
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		_ = conn.Close()
		return nil, false, err
	}
	if !acquired {
		_ = conn.Close()
		return nil, false, nil
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			// Cleanup must work even after the HTTP request is cancelled.
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var unlocked bool
			if err := conn.QueryRowContext(cleanup, "SELECT pg_advisory_unlock($1)", key).Scan(&unlocked); err != nil || !unlocked {
				_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			}
			_ = conn.Close()
		})
	}, true, nil
}
