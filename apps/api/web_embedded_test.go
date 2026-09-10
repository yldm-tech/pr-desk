//go:build webembed

package main

import (
	"io/fs"
	"strings"
	"testing"
)

// Build the real Vite bundle before this test: placeholders cannot pass it.
func TestEmbeddedBundle(t *testing.T) {
	files := frontendFiles()
	html, err := fs.ReadFile(files, "index.html")
	if err != nil || !strings.Contains(string(html), "/assets/") {
		t.Fatalf("missing production index: %v", err)
	}
	assets, err := fs.Glob(files, "assets/*.js")
	if err != nil || len(assets) == 0 {
		t.Fatal("missing compiled JavaScript")
	}
	for _, name := range assets {
		body, err := fs.ReadFile(files, name)
		if err != nil || len(body) == 0 {
			t.Fatalf("invalid embedded asset %s", name)
		}
	}
}
