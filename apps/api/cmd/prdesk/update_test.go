package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	for _, tc := range []struct {
		a, b       string
		want       int
		comparable bool
	}{
		{"0.1.109", "0.1.114", -1, true},
		{"0.1.114", "0.1.109", 1, true},
		{"0.1.114", "0.1.114", 0, true},
		// Not lexicographic: "0.1.99" sorts after "0.1.114" as text.
		{"0.1.99", "0.1.114", -1, true},
		{"v0.1.109", "0.1.114", -1, true},
		{"0.2", "0.1.999", 1, true},
		{"0.1", "0.1.1", -1, true},
		// A build from a checkout has no place in an ordering.
		{"dev", "0.1.114", 0, false},
		{"0.1.114", "dev", 0, false},
		{"0.1.x", "0.1.114", 0, false},
	} {
		t.Run(tc.a+"_vs_"+tc.b, func(t *testing.T) {
			got, ok := compareVersions(tc.a, tc.b)
			if ok != tc.comparable {
				t.Fatalf("comparable was %v, wanted %v", ok, tc.comparable)
			}
			if ok && got != tc.want {
				t.Fatalf("comparison was %d, wanted %d", got, tc.want)
			}
		})
	}
}

func TestChecksumFor(t *testing.T) {
	sums := "aaa  prdesk-linux-amd64\nbbb  prdesk-darwin-arm64\n"
	if got := checksumFor(sums, "prdesk-darwin-arm64"); got != "bbb" {
		t.Fatalf("checksum was %q", got)
	}
	if got := checksumFor(sums, "prdesk-windows-amd64"); got != "" {
		t.Fatalf("a missing asset returned %q", got)
	}
	// A name that is a suffix of another must not match it.
	if got := checksumFor("ccc  prdesk-linux-amd64\n", "amd64"); got != "" {
		t.Fatalf("a partial name matched: %q", got)
	}
}

// The mirror that serves the assets is no use if the version behind them can
// only be looked up on api.github.com, which is the one step PRDESK_RELEASE_BASE
// never reached.
func TestLatestReleaseUsesTheConfiguredApiBase(t *testing.T) {
	status, payload := http.StatusOK, `{"tag_name":"v0.1.200"}`
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/"+releaseRepo()+"/releases/latest", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		w.Write([]byte(payload))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	t.Setenv("PRDESK_RELEASE_API", server.URL+"/")

	latest, err := latestRelease()
	if err != nil {
		t.Fatal(err)
	}
	if latest != "0.1.200" {
		t.Fatalf("the release was %q, wanted 0.1.200", latest)
	}

	status, payload = http.StatusNotFound, ""
	if _, err := latestRelease(); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("a missing release was not reported with its status: %v", err)
	}

	status, payload = http.StatusOK, `{}`
	if _, err := latestRelease(); err == nil || !strings.Contains(err.Error(), "no tag") {
		t.Fatalf("an untagged release was not reported: %v", err)
	}
}

// releaseServer stands in for the GitHub release download host.
func releaseServer(t *testing.T, tag string, payload []byte, sums string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/"+releaseRepo()+"/releases/download/v"+tag+"/"+assetName(), func(w http.ResponseWriter, _ *http.Request) {
		w.Write(payload)
	})
	mux.HandleFunc("/"+releaseRepo()+"/releases/download/v"+tag+"/SHA256SUMS", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(sums))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func sumOf(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// The binary is replaced in place, so a corrupted download must never reach the
// path the user runs.
func TestReplaceBinaryRefusesAMismatchedChecksum(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "prdesk")
	if err := os.WriteFile(target, []byte("the installed binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte("the replacement")
	server := releaseServer(t, "0.1.200", payload, "0000000000000000000000000000000000000000000000000000000000000000  "+assetName()+"\n")
	t.Setenv("PRDESK_RELEASE_BASE", server.URL)

	err := replaceBinary(target, "0.1.200")
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("a corrupted download was accepted: %v", err)
	}
	current, readErr := os.ReadFile(target)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(current) != "the installed binary" {
		t.Fatal("the installed binary was replaced despite the mismatch")
	}
	// Nothing half-written left beside it.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("a staged file was left behind: %d entries", len(entries))
	}
}

func TestReplaceBinaryInstallsAVerifiedDownload(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "prdesk")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte("the replacement binary")
	server := releaseServer(t, "0.1.200", payload, sumOf(payload)+"  "+assetName()+"\n")
	t.Setenv("PRDESK_RELEASE_BASE", server.URL)

	if err := replaceBinary(target, "0.1.200"); err != nil {
		t.Fatal(err)
	}
	current, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(current) != string(payload) {
		t.Fatalf("the binary was not replaced: %q", current)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("the replacement is not executable: %v", info.Mode())
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("a staged file was left behind: %d entries", len(entries))
	}
}

func TestReplaceBinaryReportsAnUnwritableDestination(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "prdesk")
	if err := os.WriteFile(target, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte("the replacement binary")
	server := releaseServer(t, "0.1.200", payload, sumOf(payload)+"  "+assetName()+"\n")
	t.Setenv("PRDESK_RELEASE_BASE", server.URL)
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o700) })

	err := replaceBinary(target, "0.1.200")
	if err == nil {
		t.Fatal("an unwritable destination was reported as success")
	}
	// The message has to say what to do, not just that a write failed.
	if !strings.Contains(err.Error(), "install-cli.sh") && !strings.Contains(err.Error(), "PRDESK_INSTALL_DIR") {
		t.Fatalf("the failure gives the user nowhere to go: %v", err)
	}
}

func captureStderr(t *testing.T, run func()) string {
	t.Helper()
	original := os.Stderr
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = writer
	run()
	writer.Close()
	os.Stderr = original
	out, err := readAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func readAll(reader *os.File) (string, error) {
	defer reader.Close()
	buffer := make([]byte, 0, 512)
	chunk := make([]byte, 512)
	for {
		n, err := reader.Read(chunk)
		buffer = append(buffer, chunk[:n]...)
		if err != nil {
			return string(buffer), nil
		}
	}
}

// Running an old client against a newer deployment is how a fixed bug looks
// unfixed. The notice must appear, and must stay out of --json on stdout.
func TestServerVersionNoticeOnlyOnRealSkew(t *testing.T) {
	original := version
	t.Cleanup(func() { version = original })

	version = "0.1.109"
	if out := captureStderr(t, func() { noticeServerVersion("0.1.114") }); !strings.Contains(out, "older") || !strings.Contains(out, "prdesk update") {
		t.Fatalf("an out-of-date client was not told to update: %q", out)
	}
	if out := captureStderr(t, func() { noticeServerVersion("0.1.100") }); !strings.Contains(out, "different releases") {
		t.Fatalf("a client ahead of the server said nothing useful: %q", out)
	}
	if out := captureStderr(t, func() { noticeServerVersion("0.1.109") }); out != "" {
		t.Fatalf("matching versions produced noise: %q", out)
	}
	// A local server or a source build is not skew worth reporting.
	if out := captureStderr(t, func() { noticeServerVersion("dev") }); out != "" {
		t.Fatalf("a development server produced noise: %q", out)
	}
	// Deployments that predate the server reporting its release send a bare "1".
	// Comparing against that yields "older than the server's 1", which parses as
	// a real comparison and means nothing.
	if out := captureStderr(t, func() { noticeServerVersion("1") }); out != "" {
		t.Fatalf("the legacy placeholder was compared as a version: %q", out)
	}
	if out := captureStderr(t, func() { noticeServerVersion("") }); out != "" {
		t.Fatalf("a silent server produced noise: %q", out)
	}
	version = "dev"
	if out := captureStderr(t, func() { noticeServerVersion("0.1.114") }); out != "" {
		t.Fatalf("a source build produced noise: %q", out)
	}
}
