package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResultPageReportsOutcome(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		status int
		view   resultView
		expect string
	}{
		{"authorized", http.StatusOK, authorizedView, "Authorization complete"},
		{"declined", http.StatusOK, declinedView, "Authorization declined"},
		{"mismatch", http.StatusBadRequest, mismatchView, "could not be verified"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			writeResultPage(recorder, testCase.status, testCase.view)
			if recorder.Code != testCase.status {
				t.Fatalf("status = %d, want %d", recorder.Code, testCase.status)
			}
			if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
				t.Fatalf("content type = %q", got)
			}
			body := recorder.Body.String()
			if !strings.Contains(body, testCase.expect) {
				t.Fatalf("body does not report the outcome: %q missing", testCase.expect)
			}
			if !strings.Contains(body, "close this tab") {
				t.Fatal("body does not tell the reader the browser is finished")
			}
		})
	}
}
