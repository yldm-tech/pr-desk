package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// The same repository scripts/install-cli.sh bootstraps from. PRDESK_REPO keeps
// the two agreeing when either is pointed at a fork.
func releaseRepo() string {
	if repo := os.Getenv("PRDESK_REPO"); repo != "" {
		return repo
	}
	return "yldm-tech/pr-desk"
}

func assetName() string { return fmt.Sprintf("prdesk-%s-%s", runtime.GOOS, runtime.GOARCH) }

// Where release assets are fetched from. Overridable for a mirror or an
// enterprise host; the checksum is verified whatever this points at, so a
// redirected download still cannot install something the release did not
// publish alongside its own SHA256SUMS.
func releaseBase() string {
	if base := os.Getenv("PRDESK_RELEASE_BASE"); base != "" {
		return strings.TrimSuffix(base, "/")
	}
	return "https://github.com"
}

func latestRelease() (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Get("https://api.github.com/repos/" + releaseRepo() + "/releases/latest")
	if err != nil {
		return "", errors.New("cannot reach GitHub to look for a newer release")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub answered %d when asked for the latest release", response.StatusCode)
	}
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return "", errors.New("cannot read the latest release")
	}
	if payload.TagName == "" {
		return "", errors.New("the latest release has no tag")
	}
	return strings.TrimPrefix(payload.TagName, "v"), nil
}

// Versions are 0.1.<CI run number>. A value this cannot parse — "dev", or
// anything a fork numbers differently — compares as unknown rather than
// guessing an order, so the caller reports a difference instead of a direction.
func compareVersions(a, b string) (int, bool) {
	left, leftOK := parseVersion(a)
	right, rightOK := parseVersion(b)
	if !leftOK || !rightOK {
		return 0, false
	}
	for i := 0; i < len(left) && i < len(right); i++ {
		if left[i] != right[i] {
			if left[i] < right[i] {
				return -1, true
			}
			return 1, true
		}
	}
	switch {
	case len(left) < len(right):
		return -1, true
	case len(left) > len(right):
		return 1, true
	}
	return 0, true
}

func parseVersion(value string) ([]int, bool) {
	parts := strings.Split(strings.TrimPrefix(value, "v"), ".")
	numbers := make([]int, 0, len(parts))
	for _, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		numbers = append(numbers, number)
	}
	return numbers, len(numbers) > 0
}

func runUpdate(args []string) error {
	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	check := flags.Bool("check", false, "report whether a newer release exists without installing it")
	if err := flags.Parse(args); err != nil {
		return err
	}
	latest, err := latestRelease()
	if err != nil {
		return err
	}
	if version == latest {
		fmt.Printf("prdesk %s is the latest release.\n", version)
		return nil
	}
	order, comparable := compareVersions(version, latest)
	if comparable && order > 0 {
		fmt.Printf("prdesk %s is newer than the latest release %s; nothing to do.\n", version, latest)
		return nil
	}
	if *check {
		fmt.Printf("prdesk %s is installed; %s is available. Run: prdesk update\n", version, latest)
		return nil
	}
	target, err := os.Executable()
	if err != nil {
		return errors.New("cannot locate this binary to replace it")
	}
	// A managed install is usually a symlink; replacing the link would leave the
	// real binary stale and break the next update.
	if resolved, err := filepath.EvalSymlinks(target); err == nil {
		target = resolved
	}
	if err := replaceBinary(target, latest); err != nil {
		return err
	}
	fmt.Printf("prdesk updated from %s to %s at %s\n", version, latest, target)
	return nil
}

func replaceBinary(target, release string) error {
	asset := assetName()
	base := releaseBase() + "/" + releaseRepo() + "/releases/download/v" + release
	binary, err := download(base + "/" + asset)
	if err != nil {
		return fmt.Errorf("cannot download %s for %s: %w", asset, release, err)
	}
	sums, err := download(base + "/SHA256SUMS")
	if err != nil {
		return fmt.Errorf("cannot download the checksums for %s: %w", release, err)
	}
	expected := checksumFor(string(sums), asset)
	if expected == "" {
		return fmt.Errorf("release %s publishes no checksum for %s", release, asset)
	}
	sum := sha256.Sum256(binary)
	if actual := hex.EncodeToString(sum[:]); actual != expected {
		return fmt.Errorf("checksum mismatch for %s; refusing to replace the installed binary", asset)
	}
	// Staged beside the target so the rename stays within one file system, which
	// is what makes the replacement atomic. Renaming over a running binary is
	// safe: the open file keeps the old inode until the process exits.
	staged := filepath.Join(filepath.Dir(target), "."+filepath.Base(target)+".update")
	if err := os.WriteFile(staged, binary, 0o755); err != nil {
		return fmt.Errorf("cannot write next to %s; reinstall with scripts/install-cli.sh or choose a writable PRDESK_INSTALL_DIR: %w", target, err)
	}
	if err := os.Rename(staged, target); err != nil {
		os.Remove(staged)
		return fmt.Errorf("cannot replace %s: %w", target, err)
	}
	return nil
}

func download(url string) ([]byte, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	response, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	// Bounded so a wrong URL answering with something enormous cannot exhaust
	// memory; the binaries are around 11 MB.
	return io.ReadAll(io.LimitReader(response.Body, 128<<20))
}

func checksumFor(sums, asset string) string {
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == asset {
			return fields[0]
		}
	}
	return ""
}

// noticeServerVersion warns when the client and the deployment it just talked to
// are not the same release. It goes to standard error so that --json stays a
// clean document for jq, and says nothing when either side is a development
// build or the two agree.
func noticeServerVersion(serverVersion string) {
	if serverVersion == "" || serverVersion == "dev" || version == "dev" || serverVersion == version {
		return
	}
	// Before the server reported its release it sent a bare "1" here, and every
	// deployment that has not been upgraded still does. Comparing against that
	// produces "older than the server's 1", which is worse than silence.
	// A release is dotted; anything else is not a version this can reason about.
	if !strings.Contains(serverVersion, ".") {
		return
	}
	order, comparable := compareVersions(version, serverVersion)
	if comparable && order < 0 {
		fmt.Fprintf(os.Stderr, "note: prdesk %s is older than the server's %s; run prdesk update\n", version, serverVersion)
		return
	}
	fmt.Fprintf(os.Stderr, "note: prdesk %s and the server's %s are different releases\n", version, serverVersion)
}
