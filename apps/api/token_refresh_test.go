package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// Every row written before renewal existed looks like this: a token, no expiry, no refresh token. The whole feature is conditional on those two columns, so this is the case that proves an existing deployment is untouched.
func TestLegacyRowIsNeverTreatedAsExpired(t *testing.T) {
	legacy := OAuthToken{Token: "cipher"}
	if legacy.refreshable() {
		t.Fatal("a row with no refresh token and no expiry must not be refreshable")
	}
	if legacy.tokenExpired(time.Now().Add(100 * 365 * 24 * time.Hour)) {
		t.Fatal("a row with no expiry must never read as expired, however far the clock is moved")
	}
}

func TestTokenExpiryWindow(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name    string
		expiry  time.Time
		expired bool
	}{
		{"comfortably valid", now.Add(8 * time.Hour), false},
		{"just outside the window", now.Add(tokenRefreshWindow + time.Minute), false},
		// Inside the window counts as spent: a sync holds one plaintext for its whole walk, so a token that dies in nine minutes is no use to a run starting now.
		{"just inside the window", now.Add(tokenRefreshWindow - time.Minute), true},
		{"already gone", now.Add(-time.Second), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			expiry := test.expiry
			account := OAuthToken{Token: "cipher", RefreshToken: "cipher", TokenExpiresAt: &expiry}
			if got := account.tokenExpired(now); got != test.expired {
				t.Fatalf("tokenExpired = %v, want %v", got, test.expired)
			}
		})
	}
}

func TestRefreshableNeedsBothHalves(t *testing.T) {
	expiry := time.Now().Add(time.Hour)
	if (OAuthToken{RefreshToken: "cipher"}).refreshable() {
		t.Fatal("a refresh token with no expiry is not enough: nothing would ever trigger the renewal")
	}
	if (OAuthToken{TokenExpiresAt: &expiry}).refreshable() {
		t.Fatal("an expiry with no refresh token is not renewable")
	}
	if !(OAuthToken{RefreshToken: "cipher", TokenExpiresAt: &expiry}).refreshable() {
		t.Fatal("both halves present must be refreshable")
	}
}

func TestStoreTokenKeepsBothSecretsEncrypted(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	expiry := time.Now().Add(8 * time.Hour).Truncate(time.Second)
	var row OAuthToken
	if err := storeToken(&row, &oauth2.Token{AccessToken: "access-plain", RefreshToken: "refresh-plain", Expiry: expiry}); err != nil {
		t.Fatal(err)
	}
	if row.Token == "access-plain" || row.RefreshToken == "refresh-plain" {
		t.Fatal("a secret reached the column in plaintext")
	}
	access, err := decrypt(row.Token)
	if err != nil || access != "access-plain" {
		t.Fatalf("access token did not round trip: %q %v", access, err)
	}
	refresh, err := decrypt(row.RefreshToken)
	if err != nil || refresh != "refresh-plain" {
		t.Fatalf("refresh token did not round trip: %q %v", refresh, err)
	}
	if row.TokenExpiresAt == nil || !row.TokenExpiresAt.Equal(expiry.UTC()) {
		t.Fatalf("expiry not stored: %v", row.TokenExpiresAt)
	}
}

// An App with "Expire user authorization tokens" switched off sends an access token and nothing else. Such an account must land on the never-renew path rather than acquire an expiry it has no way to honour.
func TestStoreTokenWithoutExpiryClearsRenewalColumns(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	previous := time.Now().Add(time.Hour)
	row := OAuthToken{RefreshToken: "stale", TokenExpiresAt: &previous, RefreshExpiresAt: &previous}
	if err := storeToken(&row, &oauth2.Token{AccessToken: "access-plain"}); err != nil {
		t.Fatal(err)
	}
	if row.RefreshToken != "" || row.TokenExpiresAt != nil || row.RefreshExpiresAt != nil {
		t.Fatalf("a grant without renewal must clear every renewal column, got %q %v %v", row.RefreshToken, row.TokenExpiresAt, row.RefreshExpiresAt)
	}
	if row.refreshable() {
		t.Fatal("cleared row must not be refreshable")
	}
}

// GORM skips zero values on a struct update, so clearing a refresh token has to go through the map form. If this ever silently stopped emitting the empty string, a reconnect would leave the previous refresh token live.
func TestTokenColumnsAlwaysWritesEveryColumn(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	columns, err := tokenColumns(&oauth2.Token{AccessToken: "access-plain"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"token", "refresh_token", "token_expires_at", "refresh_expires_at"} {
		if _, ok := columns[key]; !ok {
			t.Fatalf("column %q missing; a reconnect would leave the previous value in place", key)
		}
	}
	if columns["refresh_token"] != "" {
		t.Fatalf("refresh_token should be cleared, got %v", columns["refresh_token"])
	}
}

// GitHub reports the refresh token's lifetime in a non-standard field, and which Go type it arrives as depends on how the response was decoded.
func TestRefreshLifetimeAcceptsEveryShape(t *testing.T) {
	for _, test := range []struct {
		name  string
		value any
		want  int64
	}{
		{"json.Number", json.Number("15897600"), 15897600},
		{"float64", float64(15897600), 15897600},
		{"int64", int64(15897600), 15897600},
		{"string", "15897600", 15897600},
		{"absent", nil, 0},
		{"unparseable", "soon", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := map[string]any{"access_token": "a"}
			if test.value != nil {
				raw["refresh_token_expires_in"] = test.value
			}
			tok := (&oauth2.Token{AccessToken: "a"}).WithExtra(raw)
			if got := refreshLifetime(tok); got != test.want {
				t.Fatalf("refreshLifetime = %d, want %d", got, test.want)
			}
		})
	}
}

func TestAccessTokenForReturnsStoredTokenWhenStillValid(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationPoolDB(t)
	server := &Server{db: db}
	cipher, err := crypt("live-access")
	if err != nil {
		t.Fatal(err)
	}
	expiry := time.Now().Add(4 * time.Hour)
	account := OAuthToken{GitHubID: 42, SessionID: "session-valid", Token: cipher, RefreshToken: "unused", TokenExpiresAt: &expiry}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	// A renewal here would be a bug: the stored token has four hours left.
	stubExchange(t, func(context.Context, string) (*oauth2.Token, error) {
		t.Error("renewed a token that had not expired")
		return nil, errors.New("must not be called")
	})
	got, err := server.accessTokenFor(context.Background(), account)
	if err != nil || got != "live-access" {
		t.Fatalf("accessTokenFor = %q, %v; want the stored token", got, err)
	}
}

func TestAccessTokenForRenewsAndPersistsTheRotatedPair(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationPoolDB(t)
	server := &Server{db: db}
	access, err := crypt("spent-access")
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := crypt("first-refresh")
	if err != nil {
		t.Fatal(err)
	}
	expired := time.Now().Add(-time.Minute)
	// A stale failure flag as well: a successful renewal has to lift the suspension, or an account that lapsed once stays excluded from the workers forever.
	account := OAuthToken{GitHubID: 43, SessionID: "session-renew", Token: access, RefreshToken: refresh, TokenExpiresAt: &expired, AuthorizationError: "reconnect"}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	presented := ""
	stubExchange(t, func(_ context.Context, given string) (*oauth2.Token, error) {
		presented = given
		return (&oauth2.Token{AccessToken: "second-access", RefreshToken: "second-refresh", Expiry: time.Now().Add(8 * time.Hour)}).WithExtra(map[string]any{"refresh_token_expires_in": json.Number("15897600")}), nil
	})
	got, err := server.accessTokenFor(context.Background(), account)
	if err != nil {
		t.Fatal(err)
	}
	if got != "second-access" {
		t.Fatalf("accessTokenFor = %q, want the renewed token", got)
	}
	if presented != "first-refresh" {
		t.Fatalf("exchanged %q, want the decrypted stored refresh token", presented)
	}
	var stored OAuthToken
	if err := db.Where("id = ?", account.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	// GitHub retires the refresh token it was handed, so failing to persist the rotated one loses the account.
	rotated, err := decrypt(stored.RefreshToken)
	if err != nil || rotated != "second-refresh" {
		t.Fatalf("rotated refresh token not persisted: %q %v", rotated, err)
	}
	if stored.TokenExpiresAt == nil || !stored.TokenExpiresAt.After(time.Now().Add(7*time.Hour)) {
		t.Fatalf("new expiry not persisted: %v", stored.TokenExpiresAt)
	}
	if stored.RefreshExpiresAt == nil {
		t.Fatal("refresh lifetime not recorded")
	}
	if stored.AuthorizationError != "" {
		t.Fatalf("a successful renewal must clear the failure flag, got %q", stored.AuthorizationError)
	}
}

func TestAccessTokenForMarksTheAccountWhenRenewalIsRefused(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationPoolDB(t)
	server := &Server{db: db}
	access, err := crypt("spent-access")
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := crypt("expired-refresh")
	if err != nil {
		t.Fatal(err)
	}
	expired := time.Now().Add(-time.Minute)
	account := OAuthToken{GitHubID: 44, SessionID: "session-refused", Token: access, RefreshToken: refresh, TokenExpiresAt: &expired}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	stubExchange(t, func(context.Context, string) (*oauth2.Token, error) {
		return nil, errors.New("bad_refresh_token")
	})
	if _, err := server.accessTokenFor(context.Background(), account); !errors.Is(err, errTokenLapsed) {
		t.Fatalf("err = %v, want errTokenLapsed", err)
	}
	var stored OAuthToken
	if err := db.Where("id = ?", account.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	// The same flag a 401 from a sync already sets, so the browser shows the reconnect banner it always did and this feature adds no new vocabulary.
	if stored.AuthorizationError != "reconnect" {
		t.Fatalf("AuthorizationError = %q, want reconnect", stored.AuthorizationError)
	}
}

// The second caller through the lock must adopt the first one's result. Spending a second renewal would retire the pair the first caller just stored.
func TestRenewalAdoptsAConcurrentWinnersResult(t *testing.T) {
	t.Setenv("TOKEN_ENCRYPTION_KEY", testKey)
	db := integrationPoolDB(t)
	server := &Server{db: db}
	access, err := crypt("spent-access")
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := crypt("first-refresh")
	if err != nil {
		t.Fatal(err)
	}
	expired := time.Now().Add(-time.Minute)
	account := OAuthToken{GitHubID: 45, SessionID: "session-race", Token: access, RefreshToken: refresh, TokenExpiresAt: &expired}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}
	// Stand in for the winner: the row is already renewed by the time this caller reaches the re-read inside the lock.
	winner, err := crypt("winner-access")
	if err != nil {
		t.Fatal(err)
	}
	fresh := time.Now().Add(8 * time.Hour)
	if err := db.Model(&OAuthToken{}).Where("id = ?", account.ID).Updates(map[string]any{"token": winner, "token_expires_at": &fresh}).Error; err != nil {
		t.Fatal(err)
	}
	stubExchange(t, func(context.Context, string) (*oauth2.Token, error) {
		t.Error("renewed again instead of adopting the result already in the row")
		return nil, errors.New("must not be called")
	})
	// `account` is the stale copy this caller read before blocking on the lock, which is exactly the situation being tested.
	got, err := server.refreshAccessToken(context.Background(), account)
	if err != nil {
		t.Fatal(err)
	}
	if got != "winner-access" {
		t.Fatalf("accessTokenFor = %q, want the token the winner stored", got)
	}
}

func stubExchange(t *testing.T, stub func(context.Context, string) (*oauth2.Token, error)) {
	t.Helper()
	previous := exchangeRefreshToken
	exchangeRefreshToken = stub
	t.Cleanup(func() { exchangeRefreshToken = previous })
}
