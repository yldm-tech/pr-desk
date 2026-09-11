package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/nikoksr/notify/service/telegram"
)

const (
	destinationTelegram = "telegram"
	destinationLark     = "lark"
	destinationEmail    = "email"
	destinationWebhook  = "webhook"
)

var destinationKinds = []string{destinationTelegram, destinationLark, destinationEmail, destinationWebhook}

// destinationConfig is the decrypted payload of every destination. Each kind
// fills in its own subset; the shared shape keeps credential retention on
// update simple and avoids a second round of type switches.
type destinationConfig struct {
	Token    string   `json:"token,omitempty"`
	ChatID   int64    `json:"chat_id,omitempty"`
	URL      string   `json:"url,omitempty"`
	Secret   string   `json:"secret,omitempty"`
	Host     string   `json:"host,omitempty"`
	Port     int      `json:"port,omitempty"`
	Username string   `json:"username,omitempty"`
	Password string   `json:"password,omitempty"`
	From     string   `json:"from,omitempty"`
	To       []string `json:"to,omitempty"`
}

// Destinations created before multiple channels existed carry no kind.
func destinationKind(kind string) string {
	if kind == "" {
		return destinationTelegram
	}
	return kind
}

func knownDestinationKind(kind string) bool {
	for _, known := range destinationKinds {
		if known == kind {
			return true
		}
	}
	return false
}

func destinationSettings(destination NotificationDestination) (destinationConfig, error) {
	var config destinationConfig
	plain, err := decrypt(destination.ConfigCipher)
	if err != nil {
		return config, fmt.Errorf("decrypt destination %d: %w", destination.ID, err)
	}
	if err := json.Unmarshal([]byte(plain), &config); err != nil {
		return config, fmt.Errorf("invalid destination configuration: %w", err)
	}
	return config, nil
}

func notificationSubject(body string) string {
	first := body
	if index := strings.IndexAny(first, "\r\n"); index >= 0 {
		first = first[:index]
	}
	first = strings.TrimSpace(first)
	if first == "" {
		return "PR Desk"
	}
	if runes := []rune(first); len(runes) > 120 {
		return string(runes[:120]) + "…"
	}
	return first
}

func sendNotification(ctx context.Context, destination NotificationDestination, delivery NotificationDelivery) error {
	config, err := destinationSettings(destination)
	if err != nil {
		return err
	}
	switch destinationKind(destination.Kind) {
	case destinationTelegram:
		return sendTelegramNotification(ctx, config, delivery.Body)
	case destinationLark:
		return sendLarkNotification(ctx, config, delivery.Body)
	case destinationEmail:
		return sendEmailNotification(ctx, config, notificationSubject(delivery.Body), delivery.Body)
	case destinationWebhook:
		return sendWebhookNotification(ctx, destination, config, delivery.Body)
	}
	return fmt.Errorf("unsupported destination kind %q", destination.Kind)
}

// sendTelegramNotification is the production adapter for nikoksr/notify.
func sendTelegramNotification(ctx context.Context, config destinationConfig, body string) error {
	if config.Token == "" || config.ChatID == 0 {
		return errors.New("invalid telegram destination configuration")
	}
	service, err := telegram.New(config.Token)
	if err != nil {
		return err
	}
	service.AddReceivers(config.ChatID)
	return service.Send(ctx, "PR Desk", body)
}

// sendLarkNotification posts to a Lark or Feishu custom bot webhook. The
// signed variant is implemented here rather than through nikoksr/notify
// because that adapter only accepts a URL, and signature validation is the
// default the group bot dialog steers people towards.
func sendLarkNotification(ctx context.Context, config destinationConfig, body string) error {
	if config.URL == "" {
		return errors.New("invalid lark destination configuration")
	}
	payload := map[string]any{"msg_type": "text", "content": map[string]string{"text": body}}
	if config.Secret != "" {
		timestamp := strconv.FormatInt(time.Now().Unix(), 10)
		// Lark signs an empty message with "timestamp\nsecret" as the key.
		mac := hmac.New(sha256.New, []byte(timestamp+"\n"+config.Secret))
		payload["timestamp"] = timestamp
		payload["sign"] = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	status, response, err := postJSON(ctx, config.URL, encoded, nil)
	if err != nil {
		return err
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("lark webhook returned %d: %s", status, strings.TrimSpace(response))
	}
	// Rejected signatures and unknown bots are reported inside a 200 response.
	var result struct {
		Code          int    `json:"code"`
		Msg           string `json:"msg"`
		StatusCode    int    `json:"StatusCode"`
		StatusMessage string `json:"StatusMessage"`
	}
	if json.Unmarshal([]byte(response), &result) == nil && (result.Code != 0 || result.StatusCode != 0) {
		return fmt.Errorf("lark webhook rejected the message: %s%s", result.Msg, result.StatusMessage)
	}
	return nil
}

func sendWebhookNotification(ctx context.Context, destination NotificationDestination, config destinationConfig, body string) error {
	if config.URL == "" {
		return errors.New("invalid webhook destination configuration")
	}
	encoded, err := json.Marshal(map[string]any{"destination": destination.Name, "subject": notificationSubject(body), "text": body, "sent_at": time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		return err
	}
	headers := map[string]string{}
	if config.Secret != "" {
		mac := hmac.New(sha256.New, []byte(config.Secret))
		mac.Write(encoded)
		headers["X-PR-Desk-Signature"] = "sha256=" + hex.EncodeToString(mac.Sum(nil))
	}
	status, response, err := postJSON(ctx, config.URL, encoded, headers)
	if err != nil {
		return err
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("webhook returned %d: %s", status, strings.TrimSpace(response))
	}
	return nil
}

// sendEmailNotification speaks SMTP directly so that implicit TLS on port 465
// works alongside STARTTLS, and so that no dependency is added for a message
// this simple. Credentials are only offered over an encrypted connection.
func sendEmailNotification(ctx context.Context, config destinationConfig, subject, body string) error {
	if config.Host == "" || config.From == "" || len(config.To) == 0 {
		return errors.New("invalid email destination configuration")
	}
	port := config.Port
	if port == 0 {
		port = 587
	}
	connection, err := outboundDialer.DialContext(ctx, "tcp", net.JoinHostPort(config.Host, strconv.Itoa(port)))
	if err != nil {
		return err
	}
	defer connection.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}
	tlsConfig := &tls.Config{ServerName: config.Host, MinVersion: tls.VersionTLS12}
	if port == 465 {
		connection = tls.Client(connection, tlsConfig)
	}
	client, err := smtp.NewClient(connection, config.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if port != 465 {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsConfig); err != nil {
				return err
			}
		}
	}
	if config.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", config.Username, config.Password, config.Host)); err != nil {
			return err
		}
	}
	if err := client.Mail(config.From); err != nil {
		return err
	}
	for _, recipient := range config.To {
		if err := client.Rcpt(recipient); err != nil {
			return err
		}
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(emailMessage(config, subject, body, time.Now())); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

var headerSanitizer = strings.NewReplacer("\r", " ", "\n", " ")

// mime.QEncoding separates its encoded words with a plain space instead of a fold, so a subject in a
// language that encodes to several bytes per character runs past the 998 octet line limit of RFC
// 5322 well before the 120 character cap applied to it. Folding between the words keeps every
// physical line short and decodes to the same subject.
func foldEncodedSubject(encoded string) string {
	return strings.ReplaceAll(encoded, "?= =?", "?=\r\n =?")
}

func emailMessage(config destinationConfig, subject, body string, now time.Time) []byte {
	headers := []string{
		"From: " + headerSanitizer.Replace(config.From),
		"To: " + headerSanitizer.Replace(strings.Join(config.To, ", ")),
		"Subject: " + foldEncodedSubject(mime.QEncoding.Encode("UTF-8", headerSanitizer.Replace(subject))),
		"Date: " + now.Format(time.RFC1123Z),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
	}
	encoded := base64.StdEncoding.EncodeToString([]byte(body))
	lines := []string{}
	for len(encoded) > 76 {
		lines = append(lines, encoded[:76])
		encoded = encoded[76:]
	}
	if encoded != "" {
		lines = append(lines, encoded)
	}
	return []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + strings.Join(lines, "\r\n") + "\r\n")
}
