package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
)

// Destination addresses are supplied by account holders and dialled by the
// server, so every webhook and SMTP target is a potential request forgery into
// the private network. The address is checked when the connection is made
// rather than when the URL is stored, which also covers DNS entries that
// resolve differently later and hosts reached through a redirect.
func privateDestinationsAllowed() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("NOTIFY_ALLOW_PRIVATE_HOSTS"))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func blockedDestinationIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsMulticast() {
		return true
	}
	// Carrier-grade NAT space reaches infrastructure that is not on the public internet either.
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return true
	}
	return false
}

func checkDialAddress(address string) error {
	if privateDestinationsAllowed() {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("unsupported destination address %q", address)
	}
	if blockedDestinationIP(net.ParseIP(host)) {
		return fmt.Errorf("destination address %s is not reachable from this server", host)
	}
	return nil
}

var outboundDialer = &net.Dialer{
	Timeout:   10 * time.Second,
	KeepAlive: 30 * time.Second,
	Control:   func(_, address string, _ syscall.RawConn) error { return checkDialAddress(address) },
}

// Redirects are not followed: the response of the first hop decides the result.
var outboundClient = &http.Client{
	Timeout:       30 * time.Second,
	Transport:     &http.Transport{DialContext: outboundDialer.DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 20 * time.Second, MaxIdleConnsPerHost: 2},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// validateDestinationURL rejects URLs that can never work before they are
// stored, so the account holder sees the mistake in the form instead of a
// delivery that keeps retrying. Plain HTTP is only accepted alongside private
// addresses, where certificates are usually unavailable.
func validateDestinationURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return "", fmt.Errorf("enter a complete URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && privateDestinationsAllowed()) {
		return "", fmt.Errorf("the URL has to use https")
	}
	if !privateDestinationsAllowed() {
		if ip := net.ParseIP(parsed.Hostname()); ip != nil && blockedDestinationIP(ip) {
			return "", fmt.Errorf("the URL points at an address that is not reachable from this server")
		}
	}
	return trimmed, nil
}

func validateDestinationHost(host string) (string, error) {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" || strings.ContainsAny(trimmed, " /:") {
		return "", fmt.Errorf("enter a host name")
	}
	if !privateDestinationsAllowed() {
		if ip := net.ParseIP(trimmed); ip != nil && blockedDestinationIP(ip) {
			return "", fmt.Errorf("the host is not reachable from this server")
		}
	}
	return trimmed, nil
}

func postJSON(ctx context.Context, endpoint string, body []byte, headers map[string]string) (int, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return 0, "", err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.Header.Set("User-Agent", "pr-desk-notifier")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := outboundClient.Do(request)
	if err != nil {
		return 0, "", err
	}
	defer response.Body.Close()
	// Provider errors are short; a bounded read keeps a hostile endpoint from filling memory.
	payload := make([]byte, 2048)
	read, _ := response.Body.Read(payload)
	return response.StatusCode, string(payload[:read]), nil
}
