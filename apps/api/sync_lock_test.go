package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestSyncLockAcrossPoolsAndCancelledRequest(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to exercise PostgreSQL integration")
	}
	open := func() *sql.DB {
		pool, err := sql.Open("pgx", dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { pool.Close() })
		return pool
	}
	first, second := open(), open()
	sid := fmt.Sprintf("lock-test-%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	release, acquired, err := acquireSyncLock(ctx, first, sid)
	if err != nil || !acquired {
		t.Fatalf("first acquisition: %v %v", acquired, err)
	}
	defer release()
	for _, pool := range []*sql.DB{first, second} {
		retryRelease, ok, err := acquireSyncLock(context.Background(), pool, sid)
		if ok {
			retryRelease()
		}
		if err != nil || ok {
			t.Fatalf("duplicate acquisition: %v %v", ok, err)
		}
	}
	otherRelease, ok, err := acquireSyncLock(context.Background(), second, sid+"-other")
	if err != nil || !ok {
		t.Fatalf("independent session: %v %v", ok, err)
	}
	otherRelease()
	cancel()
	release()
	release() // repeated cleanup cannot unlock another caller's lock
	retryRelease, ok, err := acquireSyncLock(context.Background(), second, sid)
	if err != nil || !ok {
		t.Fatalf("after cancellation: %v %v", ok, err)
	}
	retryRelease()
	for _, pool := range []*sql.DB{first, second} {
		if pool.Stats().InUse != 0 {
			t.Fatal("reserved connection leaked")
		}
	}
}
