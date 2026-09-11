package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDestinationConfigRejectsIncompleteChannels(t *testing.T) {
	cases := []struct {
		name  string
		kind  string
		input destinationInput
	}{
		{"telegram without token", destinationTelegram, destinationInput{ChatID: 12}},
		{"telegram without chat", destinationTelegram, destinationInput{Token: "bot"}},
		{"lark without url", destinationLark, destinationInput{Secret: "s"}},
		{"webhook over plain http", destinationWebhook, destinationInput{URL: "http://example.com/hook"}},
		{"webhook at a loopback address", destinationWebhook, destinationInput{URL: "https://127.0.0.1/hook"}},
		{"lark inside the private network", destinationLark, destinationInput{URL: "https://10.1.2.3/hook"}},
		{"lark at the metadata address", destinationLark, destinationInput{URL: "https://169.254.169.254/hook"}},
		{"email without host", destinationEmail, destinationInput{From: "a@example.com", To: []string{"b@example.com"}}},
		{"email without recipients", destinationEmail, destinationInput{Host: "smtp.example.com", From: "a@example.com"}},
		{"email with an invalid sender", destinationEmail, destinationInput{Host: "smtp.example.com", From: "not-an-address", To: []string{"b@example.com"}}},
		{"email with an invalid recipient", destinationEmail, destinationInput{Host: "smtp.example.com", From: "a@example.com", To: []string{"nope"}}},
		{"email with an impossible port", destinationEmail, destinationInput{Host: "smtp.example.com", Port: 70000, From: "a@example.com", To: []string{"b@example.com"}}},
		{"unknown channel", "sms", destinationInput{}},
	}
	for _, test := range cases {
		if _, err := destinationConfigFor(test.kind, test.input, destinationConfig{}); err == nil {
			t.Errorf("%s: expected rejection", test.name)
		}
	}
}

func TestDestinationConfigAcceptsChannelsAndKeepsStoredSecrets(t *testing.T) {
	config, err := destinationConfigFor(destinationEmail, destinationInput{Host: "smtp.example.com", Port: 465, From: "PR Desk <desk@example.com>", To: []string{" first@example.com ", "Second <second@example.com>"}, Username: "desk", Password: "secret"}, destinationConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if len(config.To) != 2 || config.To[0] != "first@example.com" || config.To[1] != "second@example.com" {
		t.Fatal("recipients not normalized", config.To)
	}
	// Renaming or disabling a destination sends no credentials; they have to survive.
	kept, err := destinationConfigFor(destinationEmail, destinationInput{}, config)
	if err != nil || kept.Password != "secret" || kept.Host != "smtp.example.com" || kept.Port != 465 {
		t.Fatal("stored credentials dropped", kept, err)
	}
	lark, err := destinationConfigFor(destinationLark, destinationInput{URL: "https://open.feishu.cn/open-apis/bot/v2/hook/abc", Secret: "sign"}, destinationConfig{})
	if err != nil || lark.URL == "" || lark.Secret != "sign" {
		t.Fatal("lark destination rejected", lark, err)
	}
	if kept, err := destinationConfigFor(destinationLark, destinationInput{}, lark); err != nil || kept.Secret != "sign" {
		t.Fatal("lark secret dropped", kept, err)
	}
}

func TestPrivateDestinationsRequireAnExplicitOptIn(t *testing.T) {
	if err := checkDialAddress("10.0.0.5:443"); err == nil {
		t.Fatal("private address allowed by default")
	}
	if err := checkDialAddress("93.184.216.34:443"); err != nil {
		t.Fatal("public address blocked", err)
	}
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	if err := checkDialAddress("10.0.0.5:443"); err != nil {
		t.Fatal("opt-in ignored", err)
	}
	if _, err := validateDestinationURL("http://192.168.1.10/hook"); err != nil {
		t.Fatal("plain http rejected for an allowed private host", err)
	}
}

func TestLarkDeliverySignsAndReportsProviderRejection(t *testing.T) {
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	var received map[string]any
	response := `{"code":0,"msg":"success"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received = map[string]any{}
		_ = json.Unmarshal(body, &received)
		_, _ = w.Write([]byte(response))
	}))
	defer server.Close()
	if err := sendLarkNotification(context.Background(), destinationConfig{URL: server.URL, Secret: "topsecret"}, "PR Desk · line one\nline two"); err != nil {
		t.Fatal(err)
	}
	if received["msg_type"] != "text" {
		t.Fatal("unexpected payload", received)
	}
	timestamp, _ := received["timestamp"].(string)
	mac := hmac.New(sha256.New, []byte(timestamp+"\n"+"topsecret"))
	if received["sign"] != base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
		t.Fatal("signature does not match the Lark scheme", received)
	}
	// Lark answers a rejected signature with HTTP 200 and an error code.
	response = `{"code":19021,"msg":"sign match fail"}`
	if err := sendLarkNotification(context.Background(), destinationConfig{URL: server.URL, Secret: "topsecret"}, "body"); err == nil {
		t.Fatal("provider rejection reported as success")
	}
}

// Lark reports a rejection inside an HTTP 200 body. A body that arrives in
// several chunks has to be drained completely, because a prefix does not parse
// and the delivery would be recorded as sent and never retried.
func TestLarkRejectionIsDetectedWhenTheBodyArrivesInChunks(t *testing.T) {
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":19021,`))
		w.(http.Flusher).Flush()
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte(`"msg":"sign match fail"}`))
	}))
	defer server.Close()
	if err := sendLarkNotification(context.Background(), destinationConfig{URL: server.URL, Secret: "topsecret"}, "body"); err == nil {
		t.Fatal("a rejection split across chunks was reported as a successful delivery")
	}
}

func TestWebhookDeliverySignsTheBodyAndFailsOnErrorStatus(t *testing.T) {
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	status := 200
	var signature, body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body, signature = string(raw), r.Header.Get("X-PR-Desk-Signature")
		w.WriteHeader(status)
	}))
	defer server.Close()
	destination := NotificationDestination{Name: "ops", Kind: destinationWebhook}
	if err := sendWebhookNotification(context.Background(), destination, destinationConfig{URL: server.URL, Secret: "shared"}, "PR Desk · subject line\ndetail"); err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, []byte("shared"))
	mac.Write([]byte(body))
	if signature != "sha256="+hex.EncodeToString(mac.Sum(nil)) {
		t.Fatal("body signature missing or wrong", signature)
	}
	var payload struct {
		Destination string `json:"destination"`
		Subject     string `json:"subject"`
		Text        string `json:"text"`
	}
	if json.Unmarshal([]byte(body), &payload) != nil || payload.Destination != "ops" || payload.Subject != "PR Desk · subject line" || !strings.Contains(payload.Text, "detail") {
		t.Fatal("unexpected webhook payload", body)
	}
	status = 500
	if err := sendWebhookNotification(context.Background(), destination, destinationConfig{URL: server.URL}, "body"); err == nil {
		t.Fatal("error status reported as success")
	}
}

func TestDeliveryRefusesPrivateEndpointsWithoutOptIn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	if err := sendWebhookNotification(context.Background(), NotificationDestination{Name: "internal"}, destinationConfig{URL: server.URL}, "body"); err == nil {
		t.Fatal("loopback endpoint reached without the opt-in")
	}
}

func TestSendNotificationRoutesByKind(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"code":0}`))
	}))
	defer server.Close()
	cipher, err := crypt(mustJSON(destinationConfig{URL: server.URL}))
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{destinationLark, destinationWebhook} {
		if err := sendNotification(context.Background(), NotificationDestination{Name: "n", Kind: kind, ConfigCipher: cipher}, NotificationDelivery{Body: "body"}); err != nil {
			t.Fatal(kind, err)
		}
	}
	if calls != 2 {
		t.Fatal("channels not dispatched", calls)
	}
	if err := sendNotification(context.Background(), NotificationDestination{Kind: "carrier-pigeon", ConfigCipher: cipher}, NotificationDelivery{Body: "body"}); err == nil {
		t.Fatal("unknown kind accepted")
	}
}

func TestEmailMessageEncodesHeadersAndBody(t *testing.T) {
	config := destinationConfig{From: "desk@example.com", To: []string{"first@example.com", "second@example.com"}}
	message := string(emailMessage(config, "跟进提醒\r\nBcc: attacker@example.com", "line one\nline two", time.Date(2026, 9, 11, 8, 0, 0, 0, time.UTC)))
	headers, encoded, found := strings.Cut(message, "\r\n\r\n")
	if !found {
		t.Fatal("no header separator")
	}
	if strings.Count(headers, "\r\n") != 6 || strings.Contains(headers, "Bcc: attacker") {
		t.Fatal("header injection not neutralized", headers)
	}
	if !strings.Contains(headers, "Content-Type: text/plain; charset=UTF-8") || !strings.Contains(headers, "To: first@example.com, second@example.com") {
		t.Fatal("unexpected headers", headers)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.TrimSpace(encoded), "\r\n", ""))
	if err != nil || string(decoded) != "line one\nline two" {
		t.Fatal("body not recoverable", err, string(decoded))
	}
}

func TestEmailMessageFoldsALongNonASCIISubject(t *testing.T) {
	config := destinationConfig{From: "desk@example.com", To: []string{"first@example.com"}}
	subject := notificationSubject(strings.Repeat("跟", 200))
	message := string(emailMessage(config, subject, "body", time.Date(2026, 9, 11, 8, 0, 0, 0, time.UTC)))
	for _, line := range strings.Split(message, "\r\n") {
		if len(line) > 998 {
			t.Fatal("header line past the RFC 5322 limit", len(line))
		}
	}
	// Folding has to survive unfolding: the decoded subject is still the trimmed original.
	decoded, err := new(mime.WordDecoder).DecodeHeader(strings.ReplaceAll(strings.SplitN(message, "\r\n\r\n", 2)[0], "\r\n ", " "))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(decoded, subject) {
		t.Fatal("subject not recoverable after folding", decoded)
	}
}

func TestNotificationSubjectUsesTheFirstLine(t *testing.T) {
	if subject := notificationSubject("fixture/repo #12 · Title\nmore"); subject != "fixture/repo #12 · Title" {
		t.Fatal(subject)
	}
	if subject := notificationSubject("   \nbody"); subject != "PR Desk" {
		t.Fatal(subject)
	}
	if subject := notificationSubject(strings.Repeat("x", 200)); len([]rune(subject)) != 121 {
		t.Fatal("long subject not trimmed", len([]rune(subject)))
	}
}

// PR titles and verbatim third-party comment excerpts travel in the body. With
// a parse mode set, "a < b" in a title breaks delivery outright and an anchor
// in someone else's comment renders as a live link inside our own message.
func TestTelegramDeliverySendsPlainTextAndNeverLeaksTheToken(t *testing.T) {
	t.Setenv("NOTIFY_ALLOW_PRIVATE_HOSTS", "true")
	var payload map[string]any
	var path string
	reply := `{"ok":true,"result":{}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		payload = map[string]any{}
		_ = json.Unmarshal(raw, &payload)
		path = r.URL.Path
		_, _ = w.Write([]byte(reply))
	}))
	original := telegramAPIBase
	telegramAPIBase = server.URL
	defer func() { telegramAPIBase = original }()

	config := destinationConfig{Token: "8100000:AAH-secret-token", ChatID: -1001234567890}
	body := "fixture/calendar #17 · fix: handle a < b\n<a href=\"https://evil.test\">Approve here</a> & done"
	if err := sendTelegramNotification(context.Background(), config, body); err != nil {
		t.Fatal(err)
	}
	if _, set := payload["parse_mode"]; set {
		t.Fatal("a parse mode was sent; markup inside titles and comments would be interpreted", payload)
	}
	if payload["text"] != body {
		t.Fatal("body was altered before sending", payload["text"])
	}
	if path != "/bot"+config.Token+"/sendMessage" {
		t.Fatal("unexpected endpoint", path)
	}

	// Telegram reports a refusal inside a 200 response.
	reply = `{"ok":false,"description":"chat not found"}`
	if err := sendTelegramNotification(context.Background(), config, "body"); err == nil {
		t.Fatal("a refusal inside ok:false was reported as delivered")
	}

	// A transport failure quotes the URL, and the URL embeds the bot token.
	server.Close()
	err := sendTelegramNotification(context.Background(), config, "body")
	if err == nil {
		t.Fatal("expected a transport failure")
	}
	if strings.Contains(err.Error(), config.Token) {
		t.Fatal("the bot token leaked into the error", err)
	}
}
