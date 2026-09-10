package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestFollowUpMutationIsolationAndConcurrentActivity(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	now := time.Now().UTC()
	for _, sid := range []string{"owner", "other"} {
		if err := db.Create(&OAuthToken{SessionID: sid}).Error; err != nil {
			t.Fatal(err)
		}
	}
	pr := PullRequest{SessionID: "owner", Repo: "fixture/repo", Number: 1, State: "open"}
	db.Create(&pr)
	facts := FollowUpFacts{Role: "authored", HumanVersion: "first", HumanAt: now, CreatedAt: now.Add(-time.Hour)}
	if err := persistFollowUp(db, pr, facts, now); err != nil {
		t.Fatal(err)
	}
	var row FollowUp
	db.Where("pull_request_id = ?", pr.ID).First(&row)
	r := gin.New()
	r.POST("/follow-ups/:id", s.updateFollowUp)
	action := func(sid, verb string, version uint64) int {
		request := httptest.NewRequest("POST", fmt.Sprintf("/follow-ups/%d", row.ID), strings.NewReader(fmt.Sprintf(`{"action":%q,"version":%d}`, verb, version)))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(&http.Cookie{Name: "pr_session", Value: sid})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, request)
		return w.Code
	}
	if code := action("other", "handled", row.Version); code != 404 {
		t.Fatalf("cross account action %d", code)
	}
	if code := action("owner", "read", row.Version); code != 200 {
		t.Fatal(code)
	}
	db.First(&row, row.ID)
	if !row.NeedsConfirmation || row.ReadVersion != row.Version {
		t.Fatal("read cleared work")
	}
	oldVersion := row.Version
	facts.HumanVersion = "second"
	facts.HumanAt = now.Add(time.Minute)
	if err := persistFollowUp(db, pr, facts, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if code := action("owner", "handled", oldVersion); code != 409 {
		t.Fatalf("lost-update prevention failed: %d", code)
	}
	db.First(&row, row.ID)
	if !row.NeedsConfirmation {
		t.Fatal("stale action cleared new feedback")
	}
	if code := action("owner", "handled", row.Version); code != 200 {
		t.Fatal(code)
	}
	db.First(&row, row.ID)
	if row.NeedsConfirmation || row.HandledVersion != row.Version {
		t.Fatal("explicit handling failed")
	}
}

func TestBaselineSuppressesHistoryButNewRequestsNotify(t *testing.T) {
	db := integrationDB(t)
	now := time.Now()
	pr := PullRequest{SessionID: "baseline", Role: "reviewer", Number: 1, Repo: "fixture/repo"}
	db.Create(&pr)
	facts := FollowUpFacts{Role: "reviewer", Requested: true, CreatedAt: now}
	if err := persistFollowUp(db, pr, facts, now); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&FollowUpEvent{}).Count(&count)
	if count != 0 {
		t.Fatal("historical notification flood")
	}
	settings := FollowUpSettings{SessionID: pr.SessionID, BaselineAt: &now, WaitDays: 7}
	db.Create(&settings)
	pr.ID = 0
	pr.Number = 2
	db.Create(&pr)
	if err := persistFollowUp(db, pr, facts, now); err != nil {
		t.Fatal(err)
	}
	db.Model(&FollowUpEvent{}).Count(&count)
	if count != 1 {
		t.Fatal("new request notification missing")
	}
	if err := persistFollowUp(db, pr, facts, now); err != nil {
		t.Fatal(err)
	}
	db.Model(&FollowUpEvent{}).Count(&count)
	if count != 1 {
		t.Fatal("unchanged request repeated")
	}
}

func TestReviewerPRsDoNotPolluteContributions(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	db.Create(&OAuthToken{SessionID: "mixed"})
	db.Create(&[]PullRequest{{SessionID: "mixed", Role: "authored", State: "open", Repo: "fixture/own"}, {SessionID: "mixed", Role: "reviewer", State: "open", Repo: "fixture/other"}})
	r := gin.New()
	r.GET("/overview", s.overview)
	r.GET("/prs", s.listPRs)
	for _, path := range []string{"/overview", "/prs"} {
		req := httptest.NewRequest("GET", path, nil)
		req.AddCookie(&http.Cookie{Name: "pr_session", Value: "mixed"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var response struct {
			Total   int
			Summary struct{ Total int }
		}
		json.Unmarshal(w.Body.Bytes(), &response)
		if path == "/overview" && response.Summary.Total != 1 || path == "/prs" && response.Total != 1 {
			t.Fatal("review counted as authored", w.Body.String())
		}
	}
}
