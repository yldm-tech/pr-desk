package main

import (
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
