package main

import (
	"context"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNotificationDestinationsAreAccountScoped(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	_, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "dest-a", Username: "a", Token: "encrypted"}, 7001, "dest-browser-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.connectAccount(context.Background(), OAuthToken{SessionID: "dest-b", Username: "b", Token: "encrypted"}, 7002, "dest-browser-b"); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.POST("/dest", s.saveNotificationDestination)
	r.GET("/dest", s.listNotificationDestinations)
	r.DELETE("/dest/:id", s.deleteNotificationDestination)
	req := func(method, path, cookie, body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, strings.NewReader(body))
		q.Header.Set("Content-Type", "application/json")
		q.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		return w
	}
	w := req("POST", "/dest", "dest-browser-a", `{"name":"primary","token":"bot-token","chat_id":123}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = req("GET", "/dest", "dest-browser-b", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "primary") {
		t.Fatal("destination leaked", w.Body.String())
	}
}
