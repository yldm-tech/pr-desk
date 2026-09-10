package main

import (
	"encoding/base64"
	"testing"
)

const testKey = "01234567890123456789012345678901"

func TestTokenRoundTrip(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	a, err := crypt("github-token")
	if err != nil {
		t.Fatal(err)
	}
	b, err := crypt("github-token")
	if err != nil {
		t.Fatal(err)
	}
	if a == b || a == "github-token" {
		t.Fatal("encryption must use a fresh nonce")
	}
	got, err := decrypt(a)
	if err != nil || got != "github-token" {
		t.Fatal("round trip failed")
	}
}

func TestTokenRejectsInvalidConfiguration(t *testing.T) {
	for _, key := range []string{"", "short", testKey + "x", "change-me-to-a-32-byte-secret-key!"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv("TOKEN_ENCRYPTION_KEY", key)
			if v, err := crypt("github-token"); err == nil || v != "" {
				t.Fatal("plaintext fallback")
			}
			if v, err := decrypt("github-token"); err == nil || v != "" {
				t.Fatal("plaintext fallback")
			}
		})
	}
}

func TestTokenRejectsCorruptionAndWrongKey(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	encrypted, err := crypt("github-token")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := base64.RawStdEncoding.DecodeString(encrypted)
	raw[len(raw)-1] ^= 1
	for _, input := range []string{"", "github-token", "%%%", "YQ", base64.RawStdEncoding.EncodeToString(raw)} {
		if got, err := decrypt(input); err == nil || got != "" {
			t.Fatal("accepted invalid ciphertext")
		}
	}
	t.Setenv("TOKEN_ENCRYPTION_KEY", "abcdefghijklmnopqrstuvwxyz123456")
	if got, err := decrypt(encrypted); err == nil || got != "" {
		t.Fatal("accepted wrong key")
	}
}

func TestTokenRejectsEmptyToken(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	if v, err := crypt(""); err == nil || v != "" {
		t.Fatal("accepted empty token")
	}
}
