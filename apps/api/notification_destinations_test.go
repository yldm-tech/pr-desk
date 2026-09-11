package main

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestNotificationDestinationsAreAccountScoped(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
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

func TestDestinationChannelsPersistAndRetainCredentials(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "kind-a", Username: "a", Token: "encrypted"}, 7101, "kind-browser-a"); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.POST("/dest", s.saveNotificationDestination)
	r.PUT("/dest/:id", s.saveNotificationDestination)
	r.GET("/dest", s.listNotificationDestinations)
	req := func(method, path, body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, strings.NewReader(body))
		q.Header.Set("Content-Type", "application/json")
		q.AddCookie(&http.Cookie{Name: "pr_session", Value: "kind-browser-a"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		return w
	}
	if w := req("POST", "/dest", `{"kind":"webhook","name":"internal","url":"https://10.0.0.9/hook"}`); w.Code != 400 {
		t.Fatal("private webhook accepted", w.Code, w.Body.String())
	}
	w := req("POST", "/dest", `{"kind":"lark","name":"team chat","url":"https://open.feishu.cn/open-apis/bot/v2/hook/abc","secret":"sign"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"kind":"lark"`) {
		t.Fatal("lark destination rejected", w.Code, w.Body.String())
	}
	var created struct{ ID uint }
	if json.Unmarshal(w.Body.Bytes(), &created) != nil || created.ID == 0 {
		t.Fatal("no destination id", w.Body.String())
	}
	if w := req("GET", "/dest", ""); !strings.Contains(w.Body.String(), `"kind":"lark"`) || !strings.Contains(w.Body.String(), `"allow_private_hosts":false`) {
		t.Fatal("channel or outbound policy missing from the list", w.Body.String())
	}
	// The form mirrors the policy, so the flag has to follow the environment.
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	if w := req("GET", "/dest", ""); !strings.Contains(w.Body.String(), `"allow_private_hosts":true`) {
		t.Fatal("opt-in not reported to the form", w.Body.String())
	}
	if w := req("POST", "/dest", `{"kind":"webhook","name":"internal","url":"http://10.0.0.9/hook"}`); w.Code != 200 {
		t.Fatal("private webhook rejected despite the opt-in", w.Code, w.Body.String())
	}
	// Disabling sends no credentials; the stored webhook has to survive it.
	if w := req("PUT", "/dest/"+strconv.Itoa(int(created.ID)), `{"name":"team chat","enabled":false}`); w.Code != 200 {
		t.Fatal("update rejected", w.Code, w.Body.String())
	}
	var row NotificationDestination
	if err := db.Where("id = ?", created.ID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	config, err := destinationSettings(row)
	if err != nil {
		t.Fatal(err)
	}
	if row.Kind != destinationLark || row.Enabled || config.Secret != "sign" || !strings.HasSuffix(config.URL, "/abc") {
		t.Fatal("update lost channel or credentials", row.Kind, row.Enabled, config)
	}
	// Destinations stored before channels existed have no kind and stay on Telegram.
	if err := db.Model(&NotificationDestination{}).Where("id = ?", created.ID).Update("kind", "").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("id = ?", created.ID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if destinationKind(row.Kind) != destinationTelegram {
		t.Fatal("legacy destination not treated as telegram", row.Kind)
	}
}
