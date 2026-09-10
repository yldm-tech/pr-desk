package main

import (
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRepositoryAccessDistinguishesMissingInstallationAndFailure(t *testing.T) {
	for _, tc := range []struct {
		code int
		body string
		want int
		text string
	}{
		{200, `{"total_count":0,"installations":[]}`, 200, `"has_installations":false`},
		{200, `{"total_count":1,"installations":[{"id":1}]}`, 200, `"has_installations":true`},
		{200, `{"installations":[{"id":1,"permissions":{"pull_requests":"read"}}]}`, 200, `"can_read_private":true`},
		{200, `{"installations":[{"id":1,"permissions":{}}]}`, 200, `"can_read_private":false`},
		{200, `{"installations":[{"id":1,"permissions":{"pull_requests":"read"},"suspended_at":"2026-01-01T00:00:00Z"}]}`, 200, `"can_read_private":false`},
		{403, `{"message":"Forbidden"}`, 502, "Unable to verify repository access"},
	} {
		t.Run(tc.body, func(t *testing.T) {
			db := integrationDB(t)
			t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
			token, err := crypt("test-access")
			if err != nil {
				t.Fatal(err)
			}
			db.Create(&OAuthToken{SessionID: "access", Token: token})
			previous := githubHTTPClient
			t.Cleanup(func() { githubHTTPClient = previous })
			githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}
			r := gin.New()
			s := &Server{db: db}
			r.GET("/access", s.repositoryAccess)
			req := httptest.NewRequest("GET", "/access", nil)
			req.AddCookie(&http.Cookie{Name: "pr_session", Value: "access"})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want || !strings.Contains(w.Body.String(), tc.text) {
				t.Fatal("incorrect access state")
			}
		})
	}
}
