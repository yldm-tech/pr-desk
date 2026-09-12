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
	"time"
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
	var created struct{ ID uint }
	var target NotificationDestination
	if err := db.Where("session_id = ?", "dest-a").First(&target).Error; err != nil {
		t.Fatal(err)
	}
	created.ID = target.ID
	if err := queueMessage(db, []NotificationDestination{target}, "delete", "synthetic notification", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if w := req("DELETE", "/dest/"+strconv.Itoa(int(created.ID)), "dest-browser-a", ""); w.Code != http.StatusNoContent {
		t.Fatal("destination not deleted", w.Code, w.Body.String())
	}
	var orphaned int64
	db.Model(&NotificationDelivery{}).Where("destination_id = ?", created.ID).Count(&orphaned)
	if orphaned != 0 {
		t.Fatal("the deleted destination left its messages behind", orphaned)
	}
}

// The failing badge is the only failure signal the settings page has, so it has
// to report the destination's current health rather than everything that ever
// happened to it.
func TestFailingDestinationIsReportedAndClearedOnSave(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "flag", Username: "flag", Token: "encrypted"}, 7201, "flag-browser"); err != nil {
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
		q.AddCookie(&http.Cookie{Name: "pr_session", Value: "flag-browser"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		return w
	}
	w := req("POST", "/dest", `{"name":"primary","token":"bot-token","chat_id":123}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var created struct{ ID uint }
	if json.Unmarshal(w.Body.Bytes(), &created) != nil || created.ID == 0 {
		t.Fatal("no destination id", w.Body.String())
	}
	if w := req("GET", "/dest", ""); !strings.Contains(w.Body.String(), `"failing":false`) {
		t.Fatal("a healthy destination was reported as failing", w.Body.String())
	}
	if err := db.Model(&NotificationDestination{}).Where("id = ?", created.ID).Update("failing", true).Error; err != nil {
		t.Fatal(err)
	}
	if w := req("GET", "/dest", ""); !strings.Contains(w.Body.String(), `"failing":true`) {
		t.Fatal("a dropped destination was not reported", w.Body.String())
	}
	// Re-entering credentials is the account holder acting on the warning.
	if w := req("PUT", "/dest/"+strconv.Itoa(int(created.ID)), `{"name":"primary","token":"new-token","chat_id":123}`); w.Code != 200 {
		t.Fatal("update rejected", w.Code, w.Body.String())
	}
	if w := req("GET", "/dest", ""); !strings.Contains(w.Body.String(), `"failing":false`) {
		t.Fatal("the warning survived new credentials", w.Body.String())
	}
}

// Every message is fanned out to every destination and drained by one serial
// loop, so an unbounded count is one account's way of starving the others.
func TestDestinationCountIsCappedPerAccount(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationDB(t)
	s := &Server{db: db}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "cap-a", Username: "a", Token: "encrypted"}, 7301, "cap-browser-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.connectAccount(context.Background(), OAuthToken{SessionID: "cap-b", Username: "b", Token: "encrypted"}, 7302, "cap-browser-b"); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(s.resolveBrowserSession)
	r.POST("/dest", s.saveNotificationDestination)
	r.PUT("/dest/:id", s.saveNotificationDestination)
	req := func(method, path, cookie, body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, strings.NewReader(body))
		q.Header.Set("Content-Type", "application/json")
		q.AddCookie(&http.Cookie{Name: "pr_session", Value: cookie})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		return w
	}
	first := uint(0)
	for i := range destinationLimit {
		w := req("POST", "/dest", "cap-browser-a", `{"name":"target `+strconv.Itoa(i)+`","token":"bot-token","chat_id":123}`)
		if w.Code != 200 {
			t.Fatal("a destination under the cap was rejected", i, w.Code, w.Body.String())
		}
		var created struct{ ID uint }
		if json.Unmarshal(w.Body.Bytes(), &created) != nil || created.ID == 0 {
			t.Fatal("no destination id", w.Body.String())
		}
		if first == 0 {
			first = created.ID
		}
	}
	if w := req("POST", "/dest", "cap-browser-a", `{"name":"one too many","token":"bot-token","chat_id":123}`); w.Code != 400 {
		t.Fatal("the cap was not enforced", w.Code, w.Body.String())
	}
	// An account at the cap still has to be able to rename or disable what it has.
	if w := req("PUT", "/dest/"+strconv.Itoa(int(first)), "cap-browser-a", `{"name":"renamed","enabled":false}`); w.Code != 200 {
		t.Fatal("an existing destination could not be edited at the cap", w.Code, w.Body.String())
	}
	if w := req("POST", "/dest", "cap-browser-b", `{"name":"another account","token":"bot-token","chat_id":123}`); w.Code != 200 {
		t.Fatal("the cap is not scoped to one account", w.Code, w.Body.String())
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
