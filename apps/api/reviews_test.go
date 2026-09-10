package main

import (
	"encoding/json"
	"testing"
)

func TestLatestReviewerDecision(t *testing.T) {
	for _, tc := range []struct{ name, data, want string }{
		{"approval supersedes changes", `[{"id":2,"state":"APPROVED","user":{"login":"a"}},{"id":1,"state":"CHANGES_REQUESTED","user":{"login":"a"}}]`, "approved"},
		{"other reviewer still blocking", `[{"id":2,"state":"APPROVED","user":{"login":"a"}},{"id":1,"state":"CHANGES_REQUESTED","user":{"login":"b"}}]`, "changes_requested"},
		{"comment preserves decision", `[{"id":1,"state":"CHANGES_REQUESTED","user":{"login":"a"}},{"id":2,"state":"COMMENTED","user":{"login":"a"}}]`, "changes_requested"},
		{"dismissal clears decision", `[{"id":1,"state":"CHANGES_REQUESTED","user":{"login":"a"}},{"id":2,"state":"DISMISSED","user":{"login":"a"}}]`, "pending"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var reviews []githubReview
			if err := json.Unmarshal([]byte(tc.data), &reviews); err != nil {
				t.Fatal(err)
			}
			if got := latestReviewStatus(reviews); got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}
