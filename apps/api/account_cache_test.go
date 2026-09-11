package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestReconnectCacheRequiresVerifiedAccount(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("fixture")
	if err != nil {
		t.Fatal(err)
	}
	old := OAuthToken{SessionID: "old-cache", Username: "fixture", Token: encrypted}
	current := OAuthToken{SessionID: "new-cache", Username: "fixture", Token: encrypted}
	if err := db.Create(&[]OAuthToken{old, current}).Error; err != nil {
		t.Fatal(err)
	}
	pr := PullRequest{SessionID: old.SessionID, Number: 7, Repo: "test/repo", State: "open"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ReviewComment{SessionID: old.SessionID, PullRequestID: pr.ID, GitHubID: 88, Body: "fixture"}).Error; err != nil {
		t.Fatal(err)
	}
	previous := githubHTTPClient
	defer func() { githubHTTPClient = previous }()
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":42,"login":"fixture"}`)), Request: r}, nil
	})}
	// A mismatched GitHub identity yields no donor, so nothing is copied.
	donor, err := findCacheDonor(context.Background(), db, current, 99)
	if err != nil {
		t.Fatal(err)
	}
	if donor != "" {
		t.Fatal("another GitHub account was offered as a cache donor", donor)
	}
	var count int64
	db.Model(&PullRequest{}).Where("session_id = ?", current.SessionID).Count(&count)
	if count != 0 {
		t.Fatal("copied another GitHub account's cache")
	}
	donor, err = findCacheDonor(context.Background(), db, current, 42)
	if err != nil {
		t.Fatal(err)
	}
	if donor != old.SessionID {
		t.Fatal("the matching account was not offered as a donor", donor)
	}
	if err := copySessionCache(db, donor, current.SessionID); err != nil {
		t.Fatal(err)
	}
	var restored PullRequest
	if err := db.Where("session_id = ?", current.SessionID).First(&restored).Error; err != nil {
		t.Fatal(err)
	}
	if restored.ID == pr.ID || restored.Number != 7 {
		t.Fatal("invalid restored PR")
	}
	var comment ReviewComment
	if err := db.Where("session_id = ?", current.SessionID).First(&comment).Error; err != nil {
		t.Fatal(err)
	}
	if comment.PullRequestID != restored.ID || comment.GitHubID != 88 {
		t.Fatal("comment association was not restored")
	}
	// Now that the cache exists, no donor is offered. That is what keeps a
	// second sign-in from copying the same rows again.
	donor, err = findCacheDonor(context.Background(), db, current, 42)
	if err != nil {
		t.Fatal(err)
	}
	if donor != "" {
		t.Fatal("a donor was offered although the cache is already populated", donor)
	}
	db.Model(&PullRequest{}).Where("session_id = ?", current.SessionID).Count(&count)
	if count != 1 {
		t.Fatal("duplicate restoration")
	}
	db.Model(&PullRequest{}).Where("session_id = ?", old.SessionID).Count(&count)
	if count != 1 {
		t.Fatal("modified original session")
	}
}
