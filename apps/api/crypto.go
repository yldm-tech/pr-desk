package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
)

// The existing nonce+ciphertext encoding is retained; plaintext is never accepted.
func tokenCipher() (cipher.AEAD, error) {
	key := []byte(os.Getenv("TOKEN_ENCRYPTION_KEY"))
	if len(key) != 32 || string(key) == "change-me-to-a-32-byte-secret-key!" {
		return nil, errors.New("TOKEN_ENCRYPTION_KEY must contain 32 bytes and must not be the example value")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func crypt(in string) (string, error) {
	g, err := tokenCipher()
	if err != nil {
		return "", err
	}
	if in == "" {
		return "", errors.New("cannot encrypt an empty token")
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", errors.New("cannot generate token nonce")
	}
	return base64.RawStdEncoding.EncodeToString(g.Seal(nonce, nonce, []byte(in), nil)), nil
}

func decrypt(in string) (string, error) {
	g, err := tokenCipher()
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(in)
	if err != nil || len(raw) < g.NonceSize()+g.Overhead() {
		return "", errors.New("invalid encrypted token")
	}
	out, err := g.Open(nil, raw[:g.NonceSize()], raw[g.NonceSize():], nil)
	if err != nil || len(out) == 0 {
		return "", errors.New("invalid encrypted token")
	}
	return string(out), nil
}
