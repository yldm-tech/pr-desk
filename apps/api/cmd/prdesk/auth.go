package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultHost    = "http://localhost:8080"
	cliClientID    = "prdesk"
	scopeRead      = "followups:read"
	scopeWrite     = "followups:write"
	loginTimeLimit = 5 * time.Minute
)

// The token lives in a file the user owns, not in an environment variable that
// every child process would inherit.
type credentials struct {
	Host      string    `json:"host"`
	Token     string    `json:"token"`
	Scopes    string    `json:"scopes"`
	ExpiresAt time.Time `json:"expires_at"`
}

func credentialsPath() (string, error) {
	base := os.Getenv("PR_DESK_CONFIG_DIR")
	if base == "" {
		home, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, "pr-desk")
	}
	return filepath.Join(base, "credentials.json"), nil
}

// storedCredentials reads the file without judging the token. Signing in again
// needs the host it was signed into, and that is exactly the moment the token
// has usually expired.
func storedCredentials() (credentials, error) {
	path, err := credentialsPath()
	if err != nil {
		return credentials{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return credentials{}, errors.New("not signed in; run: prdesk login")
	}
	var stored credentials
	if json.Unmarshal(raw, &stored) != nil || stored.Token == "" {
		return credentials{}, errors.New("the stored credentials are unreadable; run: prdesk login")
	}
	return stored, nil
}

func loadCredentials() (credentials, error) {
	stored, err := storedCredentials()
	if err != nil {
		return credentials{}, err
	}
	if !stored.ExpiresAt.IsZero() && !stored.ExpiresAt.After(time.Now()) {
		return credentials{}, errors.New("the stored token expired; run: prdesk login")
	}
	return stored, nil
}

func saveCredentials(stored credentials) error {
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	// 0600: the token is a credential, and the home directory is shared with every other process running as this user. The mode has to be asserted on a fresh inode, because os.WriteFile would apply it only when creating the file and leave a credentials.json restored from a backup or copied from another machine at whatever mode it arrived with. Renaming into place also keeps the old token readable if this write fails halfway.
	staged, err := os.CreateTemp(filepath.Dir(path), ".credentials-*")
	if err != nil {
		return err
	}
	if _, err := staged.Write(append(raw, '\n')); err != nil {
		staged.Close()
		os.Remove(staged.Name())
		return err
	}
	if err := staged.Close(); err != nil {
		os.Remove(staged.Name())
		return err
	}
	if err := os.Chmod(staged.Name(), 0o600); err != nil {
		os.Remove(staged.Name())
		return err
	}
	if err := os.Rename(staged.Name(), path); err != nil {
		os.Remove(staged.Name())
		return err
	}
	return nil
}

func runLogout() error {
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Println("Signed out on this machine. The grant itself lives until it expires or is revoked with DELETE /api/v1/api-tokens/{id}.")
	return nil
}

func randomString() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// runLogin performs the authorization code flow with PKCE against a loopback
// redirect, the pattern RFC 8252 prescribes for a native client: no secret is
// embedded, and the code cannot be replayed by another program that observed
// the redirect.
func runLogin(args []string) error {
	flags := flag.NewFlagSet("login", flag.ContinueOnError)
	host := flags.String("host", "", "PR Desk server URL")
	write := flags.Bool("write", false, "also request permission to change follow-up state")
	if _, err := parseWithPositionals(flags, args, "usage: prdesk login [--host URL] [--write]", 0, 0); err != nil {
		return err
	}
	target := strings.TrimRight(*host, "/")
	if target == "" {
		if existing, err := storedCredentials(); err == nil {
			target = existing.Host
		}
	}
	if target == "" {
		target = defaultHost
	}

	verifier, err := randomString()
	if err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state, err := randomString()
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return errors.New("cannot open a local port to receive the redirect: " + err.Error())
	}
	defer listener.Close()
	redirect := fmt.Sprintf("http://127.0.0.1:%d/callback", listener.Addr().(*net.TCPAddr).Port)

	scopes := scopeRead
	if *write {
		scopes = scopeRead + " " + scopeWrite
	}
	query := url.Values{
		"response_type": {"code"}, "client_id": {cliClientID}, "redirect_uri": {redirect},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {state},
		"scope": {scopes}, "resource": {target + "/api/v1/mcp"},
	}
	authorizeURL := target + "/api/v1/oauth/authorize?" + query.Encode()

	type result struct {
		code string
		err  error
	}
	results := make(chan result, 1)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/callback" {
			http.NotFound(w, r)
			return
		}
		if problem := r.URL.Query().Get("error"); problem != "" {
			writeResultPage(w, http.StatusOK, declinedView)
			results <- result{err: errors.New("authorization was declined: " + problem)}
			return
		}
		if r.URL.Query().Get("state") != state {
			writeResultPage(w, http.StatusBadRequest, mismatchView)
			results <- result{err: errors.New("the redirect did not carry the expected state; the login was abandoned")}
			return
		}
		writeResultPage(w, http.StatusOK, authorizedView)
		results <- result{code: r.URL.Query().Get("code")}
	})}
	go func() { _ = server.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	fmt.Println("Opening your browser to authorize this machine.")
	fmt.Println("If it does not open, visit:\n  " + authorizeURL)
	openBrowser(authorizeURL)

	var received result
	select {
	case received = <-results:
	case <-time.After(loginTimeLimit):
		return errors.New("timed out waiting for the browser to complete authorization")
	}
	if received.err != nil {
		return received.err
	}
	if received.code == "" {
		return errors.New("the redirect carried no authorization code")
	}

	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {received.code}, "redirect_uri": {redirect},
		"client_id": {cliClientID}, "code_verifier": {verifier},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target+"/api/v1/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var payload struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
	}
	if json.NewDecoder(response.Body).Decode(&payload) != nil || payload.AccessToken == "" {
		if payload.Error != "" {
			return errors.New("the server refused the authorization code: " + payload.Error)
		}
		return fmt.Errorf("the token request failed with status %d", response.StatusCode)
	}
	stored := credentials{Host: target, Token: payload.AccessToken, Scopes: payload.Scope, ExpiresAt: time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)}
	if err := saveCredentials(stored); err != nil {
		return err
	}
	path, _ := credentialsPath()
	fmt.Printf("Authorized for %s (scopes: %s).\nToken stored in %s\n", target, payload.Scope, path)
	return nil
}

func openBrowser(target string) {
	var command string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
	case "windows":
		command, args = "rundll32", []string{"url.dll,FileProtocolHandler"}
	default:
		command = "xdg-open"
	}
	// A browser that cannot be launched is not an error: the URL was printed.
	_ = exec.Command(command, append(args, target)...).Start()
}

func runStatus(args []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	asJSON := flags.Bool("json", false, "print raw JSON")
	if _, err := parseWithPositionals(flags, args, "usage: prdesk status [--json]", 0, 0); err != nil {
		return err
	}
	stored, err := loadCredentials()
	if err != nil {
		return err
	}
	body, err := callTool(stored, "get_follow_up_summary", map[string]any{})
	if err != nil {
		return err
	}
	if *asJSON {
		fmt.Println(string(body))
		return nil
	}
	fmt.Printf("Signed in to %s\nScopes: %s\nToken expires: %s\n", stored.Host, stored.Scopes, stored.ExpiresAt.Local().Format(time.RFC1123))
	return printSummary(body)
}
