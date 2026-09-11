package main

import (
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestVisibilityBackfillDoesNotAssumePublic(t *testing.T) {
	for _, body := range []string{`{"private":true}`, `{"private":false}`, `{}`} {
		t.Run(body, func(t *testing.T) {
			db := integrationDB(t)
			t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
			token, err := crypt("test-token")
			if err != nil {
				t.Fatal(err)
			}
			db.Create(&OAuthToken{SessionID: "visibility-backfill", Token: token})
			db.Create(&PullRequest{SessionID: "visibility-backfill", Repo: "org/repo", State: "open"})
			previous := githubHTTPClient
			t.Cleanup(func() { githubHTTPClient = previous })
			githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path != "/repos/org/repo" {
					t.Errorf("unexpected path: %s", req.URL.Path)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			router := gin.New()
			s := &Server{db: db}
			router.GET("/overview", s.overview)
			req := httptest.NewRequest("GET", "/overview?visibility=public", nil)
			req.AddCookie(&http.Cookie{Name: "pr_session", Value: "visibility-backfill"})
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			var row PullRequest
			db.First(&row)
			if body == "{}" {
				if w.Code != 502 || row.RepoPrivate != nil {
					t.Fatal("unknown visibility treated as public")
				}
			} else {
				if w.Code != 200 || row.RepoPrivate == nil || *row.RepoPrivate != strings.Contains(body, "true") {
					t.Fatal("visibility metadata not persisted")
				}
			}
		})
	}
}

// updated_at carries GitHub activity time, not the time our poll ran: the list
// is ordered by it and the UI prints it. A one-column gorm Update would let the
// auto-update-time callback stamp every touched row with the backfill's clock.
func TestVisibilityBackfillKeepsGitHubActivityTime(t *testing.T) {
	db := integrationDB(t)
	activity := time.Date(2021, 3, 4, 5, 6, 7, 0, time.UTC)
	row := PullRequest{SessionID: "visibility-time", Repo: "fixture/calendar", Number: 7, Title: "Old but tracked", UpdatedAt: activity}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&PullRequest{}).Where("id = ?", row.ID).UpdateColumn("updated_at", activity).Error; err != nil {
		t.Fatal(err)
	}
	if err := storeRepositoryVisibility(db, row.SessionID, row.Repo, true); err != nil {
		t.Fatal(err)
	}
	var after PullRequest
	if err := db.First(&after, row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.RepoPrivate == nil || !*after.RepoPrivate {
		t.Fatal("visibility was not written")
	}
	if !after.UpdatedAt.UTC().Equal(activity) {
		t.Fatal("the backfill moved GitHub activity time to now", after.UpdatedAt)
	}
}
