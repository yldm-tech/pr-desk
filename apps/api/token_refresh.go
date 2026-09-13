package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"golang.org/x/oauth2"
	"gorm.io/gorm"
)

// A GitHub App issues user access tokens that expire in eight hours whenever "Expire user authorization tokens" is on, which is the default for a newly created App. Before this file existed the callback kept only tok.AccessToken and dropped tok.RefreshToken on the floor, so eight hours after a login every sync got a 401, the account was marked "reconnect", and the only way back was to walk the whole OAuth flow again — once a day, forever. An App with expiry switched off issues no refresh token and no expiry at all, and those accounts must keep working untouched, which is also exactly the shape every row already in the database has.

// How long before the stated expiry a token is treated as already dead. A sync is a long walk over many requests and it holds the plaintext for its whole run, so this has to cover the run rather than just the first call.
const tokenRefreshWindow = 10 * time.Minute

// The refresh exchange itself. Kept short because it runs while holding the per-account advisory lock: every other caller wanting this account's token waits behind it.
const tokenRefreshTimeout = 15 * time.Second

// errTokenLapsed is what callers get when the grant can no longer be renewed without the user. The account has already been marked so the UI shows its reconnect banner.
var errTokenLapsed = errors.New("github authorization lapsed; reconnect required")

// The renewal exchange, as a variable so tests can stand in for GitHub. The token URL is fixed in githubOAuthConfig rather than configurable, and an environment knob that exists only for tests would be a worse seam than this one.
var exchangeRefreshToken = func(ctx context.Context, refresh string) (*oauth2.Token, error) {
	// An expiry in the past is what makes the TokenSource perform the exchange rather than hand back what it was given.
	return githubOAuthConfig().TokenSource(ctx, &oauth2.Token{RefreshToken: refresh, Expiry: time.Now().Add(-time.Minute)}).Token()
}

// refreshable reports whether this row carries everything a renewal needs. A row stored before this feature has neither field and is answered from the column as-is, which is the pre-existing behaviour exactly.
func (f OAuthToken) refreshable() bool {
	return f.RefreshToken != "" && f.TokenExpiresAt != nil
}

func (f OAuthToken) tokenExpired(now time.Time) bool {
	return f.TokenExpiresAt != nil && !f.TokenExpiresAt.After(now.Add(tokenRefreshWindow))
}

// accessTokenFor is the single place a GitHub call gets its credential. It returns a usable plaintext access token, renewing and persisting one that is spent.
//
// Serialization is not an optimisation here, it is a correctness requirement: GitHub rotates the refresh token on every renewal and invalidates the one presented. Two workers renewing the same account concurrently would each be handed a different new pair, the loser would persist a refresh token GitHub has already retired, and the account would be unrecoverable without a fresh login. The advisory lock makes that race impossible, and the re-read inside it means the second caller adopts the first one's result instead of spending a second renewal.
func (s *Server) accessTokenFor(ctx context.Context, account OAuthToken) (string, error) {
	if account.Token == "" {
		return "", errTokenLapsed
	}
	now := time.Now()
	if !account.tokenExpired(now) {
		return decrypt(account.Token)
	}
	if !account.refreshable() {
		// Expired with nothing to renew from. Mark it so the browser stops waiting for a sync that cannot happen; a row that was never refreshable in the first place reaches this only once its own expiry passes, which for pre-existing rows is never, because they carry no expiry.
		s.markTokenLapsed(account.SessionID)
		return "", errTokenLapsed
	}
	return s.refreshAccessToken(ctx, account)
}

func (s *Server) refreshAccessToken(ctx context.Context, account OAuthToken) (string, error) {
	var plaintext string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Keyed on the account row, not the browser session: several browsers and every background worker share one credential, and it is the credential that must not be renewed twice.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(account.ID)).Error; err != nil {
			return err
		}
		var current OAuthToken
		if err := tx.Where("id = ?", account.ID).First(&current).Error; err != nil {
			return err
		}
		// Someone else renewed while this call waited for the lock. Their result is the live one; spending another renewal here would retire it.
		if !current.tokenExpired(time.Now()) {
			var err error
			plaintext, err = decrypt(current.Token)
			return err
		}
		if !current.refreshable() {
			return errTokenLapsed
		}
		refresh, err := decrypt(current.RefreshToken)
		if err != nil {
			return errTokenLapsed
		}
		exchange, cancel := context.WithTimeout(ctx, tokenRefreshTimeout)
		defer cancel()
		renewed, err := exchangeRefreshToken(exchange, refresh)
		if err != nil || renewed.AccessToken == "" {
			return errTokenLapsed
		}
		updates, err := tokenColumns(renewed)
		if err != nil {
			return err
		}
		// A renewal that succeeds clears a stale failure flag, so an account that lapsed and was later reconnected elsewhere does not stay suspended.
		updates["authorization_error"] = ""
		if err := tx.Model(&OAuthToken{}).Where("id = ?", current.ID).Updates(updates).Error; err != nil {
			return err
		}
		plaintext = renewed.AccessToken
		return nil
	})
	if errors.Is(err, errTokenLapsed) {
		// Outside the transaction: the rollback would discard the mark.
		s.markTokenLapsed(account.SessionID)
		return "", errTokenLapsed
	}
	if err != nil {
		return "", err
	}
	return plaintext, nil
}

// markTokenLapsed drives the account into the same state a 401 from a sync already produced, which is what connectionQuery excludes from the workers and what /auth/status reports as sync_paused. Reusing it means this feature adds no new failure vocabulary to the UI.
func (s *Server) markTokenLapsed(sessionID string) {
	if sessionID == "" {
		return
	}
	// Deliberately not bound to the caller's context: this runs on paths that are already failing, and often the reason they failed is that the context was cancelled.
	mark, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.db.WithContext(mark).Model(&OAuthToken{}).Where("session_id = ? AND git_hub_id > 0", sessionID).Update("authorization_error", "reconnect").Error
}

// storeToken encrypts a freshly issued grant onto a row. Both secrets use the same key as before; nothing new is written in plaintext. This is the one place the four columns are derived, so the login path and the renewal path cannot drift apart.
func storeToken(dst *OAuthToken, tok *oauth2.Token) error {
	access, err := crypt(tok.AccessToken)
	if err != nil {
		return fmt.Errorf("encrypt access token: %w", err)
	}
	dst.Token = access
	// An App with token expiry disabled sends neither field. Clearing both is what keeps such an account on the never-renew path rather than giving it an expiry it cannot honour, and it is also what a reconnect must do to a row that used to carry them.
	dst.TokenExpiresAt = nil
	dst.RefreshToken = ""
	dst.RefreshExpiresAt = nil
	if !tok.Expiry.IsZero() {
		expiry := tok.Expiry.UTC()
		dst.TokenExpiresAt = &expiry
	}
	if tok.RefreshToken == "" {
		return nil
	}
	refresh, err := crypt(tok.RefreshToken)
	if err != nil {
		return fmt.Errorf("encrypt refresh token: %w", err)
	}
	dst.RefreshToken = refresh
	if seconds := refreshLifetime(tok); seconds > 0 {
		expiry := time.Now().UTC().Add(time.Duration(seconds) * time.Second)
		dst.RefreshExpiresAt = &expiry
	}
	return nil
}

// tokenColumns is storeToken as an Updates map, because GORM's struct updates skip zero values and clearing RefreshToken back to empty is a case this has to express.
func tokenColumns(tok *oauth2.Token) (map[string]any, error) {
	var row OAuthToken
	if err := storeToken(&row, tok); err != nil {
		return nil, err
	}
	return map[string]any{"token": row.Token, "refresh_token": row.RefreshToken, "token_expires_at": row.TokenExpiresAt, "refresh_expires_at": row.RefreshExpiresAt}, nil
}

// GitHub reports the refresh token's own lifetime — six months at the time of writing — in a non-standard field that oauth2 leaves in Extra. It is recorded for operators rather than acted on: the renewal path finds out the grant is gone by being refused, and a stored date cannot be trusted over that answer.
func refreshLifetime(tok *oauth2.Token) int64 {
	switch value := tok.Extra("refresh_token_expires_in").(type) {
	case json.Number:
		seconds, err := value.Int64()
		if err != nil {
			return 0
		}
		return seconds
	case float64:
		return int64(value)
	case int64:
		return value
	case string:
		var number json.Number = json.Number(value)
		seconds, err := number.Int64()
		if err != nil {
			return 0
		}
		return seconds
	default:
		return 0
	}
}
