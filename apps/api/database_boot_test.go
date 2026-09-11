package main

import (
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Exiting on the first refused connection hands a brief database outage to
// CrashLoopBackOff, whose delay grows into minutes. The boot path has to wait
// it out instead.
func TestOpenDatabaseRetriesWhileTheServerIsComingUp(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	// Nothing is listening yet: the first attempts are refused.
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	dsn := "host=127.0.0.1 port=" + strconv.Itoa(port) + " user=nobody password=nobody dbname=nothing sslmode=disable connect_timeout=1"

	started := time.Now()
	_, err = openDatabase(dsn, 3*time.Second)
	elapsed := time.Since(started)
	if err == nil {
		t.Fatal("a permanently unreachable database was reported as ready")
	}
	// It kept trying rather than giving up at once...
	if elapsed < 2*time.Second {
		t.Fatal("gave up without retrying", elapsed)
	}
	// ...and it still gave up, rather than blocking the process forever.
	if elapsed > 20*time.Second {
		t.Fatal("did not honour the deadline", elapsed)
	}
	if !strings.Contains(err.Error(), "database unreachable after") {
		t.Fatal("the failure does not say what was tried", err)
	}
}
