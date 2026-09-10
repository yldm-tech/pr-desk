package main

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProfileRequiresActiveSessionAndReturnsPublicFields(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	token, err := crypt("test-profile-token")
	if err != nil {
		t.Fatal(err)
	}
	db.Create(&OAuthToken{SessionID: "profile-active", Token: token})
	db.Create(&OAuthToken{SessionID: "profile-expired", Token: token, CreatedAt: time.Now().Add(-31 * 24 * time.Hour)})
	old := githubHTTPClient
	t.Cleanup(func() { githubHTTPClient = old })
	calls := 0
	githubHTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Path != "/user" {
			t.Errorf("wrong profile path")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"login":"test","name":"Test User","bio":"Hello","followers":12,"following":3,"public_repos":7,"created_at":"2015-01-01T00:00:00Z","email":"private@example.com","total_private_repos":99}`))}, nil
	})}
	router := gin.New()
	s := &Server{db: db}
	router.GET("/profile", s.profile)
	for _, sid := range []string{"", "unknown", "profile-expired", "profile-active"} {
		req := httptest.NewRequest("GET", "/profile", nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: sid})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if sid != "profile-active" {
			if w.Code != 401 {
				t.Fatal("unauthorized profile access")
			}
			continue
		}
		var result map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || result["login"] != "test" || result["followers"] != float64(12) {
			t.Fatal("invalid profile response")
		}
		if result["email"] != nil || result["total_private_repos"] != nil || strings.Contains(w.Body.String(), "test-profile-token") {
			t.Fatal("unrequested sensitive fields exposed")
		}
	}
	if calls != 1 {
		t.Fatal("unauthenticated request reached GitHub")
	}
}
