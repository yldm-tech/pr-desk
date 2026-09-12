package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// os.WriteFile applies its mode only when it creates the file, so a
// credentials.json that arrived from a backup or another machine at 0644 kept a
// fresh 90-day token readable by every other local account.
func TestSaveCredentialsTightensAnExistingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PR_DESK_CONFIG_DIR", dir)
	path := filepath.Join(dir, "credentials.json")
	if err := os.WriteFile(path, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := saveCredentials(credentials{Host: "https://prdesk.example.com", Token: "prdesk_fresh", Scopes: scopeRead}); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("the token was written into a file with mode %v", info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored credentials
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Token != "prdesk_fresh" || stored.Host != "https://prdesk.example.com" {
		t.Fatalf("the credentials did not round-trip: %+v", stored)
	}
	// The staged copy must not be left beside it, token and all.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("a staged file was left behind: %d entries", len(entries))
	}
}

func TestSaveCredentialsCreatesTheDirectoryAndTheFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested")
	t.Setenv("PR_DESK_CONFIG_DIR", dir)
	if err := saveCredentials(credentials{Host: "https://prdesk.example.com", Token: "prdesk_first"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "credentials.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("a new credentials file has mode %v", info.Mode().Perm())
	}
}
