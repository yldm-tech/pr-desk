package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/go-github/v68/github"
	"gorm.io/gorm"
)

// GitHub answers a request for a renamed repository's old name with a redirect to the repository by id, which is what this server does for the names below.
func renamedGitHub(t *testing.T, requests *atomic.Int32) *github.Client {
	t.Helper()
	current := map[string]string{
		"1355334712": "metasequoiaime/msime",
		"1187844001": "metasequoiaime/msime-web",
		"1362229808": "metasequoiaime/msime-backup",
		"5":          "yldm-tech/new-name",
	}
	moved := map[string]string{
		"/repos/metasequoiaime/MSIME-Apple":  "1355334712",
		"/repos/metasequoiaime/msime-apple":  "1355334712",
		"/repos/metasequoiaime/MSIME-Web":    "1187844001",
		"/repos/metasequoiaime/MSIME-Client": "1362229808",
		"/repos/yldm-tech/Old-Name":          "5",
	}
	here := map[string]bool{"/repos/metasequoiaime/msime": true, "/repos/metasequoiaime/msime-web": true, "/repos/metasequoiaime/msime-backup": true, "/repos/metasequoiaime/MSIME-Windows": true, "/repos/yldm-tech/new-name": true}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if id, ok := moved[r.URL.Path]; ok {
			http.Redirect(w, r, "/repositories/"+id, http.StatusMovedPermanently)
			return
		}
		if id, ok := strings.CutPrefix(r.URL.Path, "/repositories/"); ok {
			_ = json.NewEncoder(w).Encode(map[string]any{"full_name": current[id]})
			return
		}
		if here[r.URL.Path] {
			_ = json.NewEncoder(w).Encode(map[string]any{"full_name": strings.TrimPrefix(r.URL.Path, "/repos/")})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	gh := github.NewClient(server.Client())
	base, err := url.Parse(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	gh.BaseURL = base
	return gh
}

func renameRow(t *testing.T, db *gorm.DB, repo string, number int, githubID int64, updated time.Time) PullRequest {
	t.Helper()
	row := PullRequest{SessionID: "renames", Role: "authored", Repo: repo, Number: number, URL: "https://github.com/" + repo + "/pull/" + strconv.Itoa(number), State: "open", GitHubID: githubID, UpdatedAt: updated}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

func renameFollowUp(t *testing.T, db *gorm.DB, pr PullRequest, snoozed *time.Time) FollowUp {
	t.Helper()
	follow := FollowUp{SessionID: pr.SessionID, PullRequestID: pr.ID, Version: 1, SnoozedUntil: snoozed, FactsJSON: "{}"}
	if err := db.Create(&follow).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&FollowUpEvent{SessionID: pr.SessionID, FollowUpID: follow.ID, Version: 1}).Error; err != nil {
		t.Fatal(err)
	}
	return follow
}

func renameComment(t *testing.T, db *gorm.DB, pr PullRequest, githubID uint64) {
	t.Helper()
	if err := db.Create(&ReviewComment{SessionID: pr.SessionID, PullRequestID: pr.ID, GitHubID: githubID, CommentType: "review", URL: pr.URL + "#c"}).Error; err != nil {
		t.Fatal(err)
	}
}

type renameSnapshot struct {
	Repos    []string
	Rows     []PullRequest
	Follows  []FollowUp
	Events   int64
	Comments []ReviewComment
	Days     map[string]int
}

func snapshotRenames(t *testing.T, db *gorm.DB) renameSnapshot {
	t.Helper()
	var snap renameSnapshot
	if err := db.Model(&PullRequest{}).Where("session_id = ?", "renames").Distinct("repo").Order("repo").Pluck("repo", &snap.Repos).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("session_id = ?", "renames").Order("id").Find(&snap.Rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("session_id = ?", "renames").Order("id").Find(&snap.Follows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&FollowUpEvent{}).Where("session_id = ?", "renames").Count(&snap.Events).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("session_id = ?", "renames").Order("pull_request_id, git_hub_id").Find(&snap.Comments).Error; err != nil {
		t.Fatal(err)
	}
	var settings FollowUpSettings
	if err := db.Where("session_id = ?", "renames").First(&settings).Error; err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(settings.RepositoryDaysJSON), &snap.Days); err != nil {
		t.Fatal(err)
	}
	for i := range snap.Rows {
		snap.Rows[i].RepoNameCheckedAt = nil
	}
	return snap
}

// The shape found in production: one repository under three names (renamed twice), a rename that only changed case, a rename to another word, a repository that kept its name and one that is gone. Rows under the old names were frozen at the state they had on the day of the rename, and the pull requests seen since arrived as second rows under the new name.
func TestRepositoryNameCheckFoldsEveryOldNameIntoTheCurrentOne(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	ctx := context.Background()
	day := func(n int) time.Time { return time.Date(2026, 9, n, 0, 0, 0, 0, time.UTC) }
	snoozed := day(30)

	frozen := renameRow(t, db, "metasequoiaime/MSIME-Apple", 3, 0, day(1))
	renameFollowUp(t, db, frozen, &snoozed)
	renameComment(t, db, frozen, 10)
	middle := renameRow(t, db, "metasequoiaime/msime-apple", 3, 3003, day(2))
	current := renameRow(t, db, "metasequoiaime/msime", 3, 0, day(3))
	kept := renameFollowUp(t, db, current, nil)
	renameComment(t, db, current, 10)
	renameComment(t, db, current, 11)
	onlyOld := renameRow(t, db, "metasequoiaime/MSIME-Apple", 5, 0, day(1))
	onlyOldFollow := renameFollowUp(t, db, onlyOld, &snoozed)
	caseOnly := renameRow(t, db, "metasequoiaime/MSIME-Web", 1, 0, day(1))
	renameComment(t, db, caseOnly, 20)
	renameRow(t, db, "metasequoiaime/msime-web", 1, 0, day(4))
	renameRow(t, db, "metasequoiaime/MSIME-Client", 2, 0, day(1))
	windows := renameRow(t, db, "metasequoiaime/MSIME-Windows", 9, 0, day(1))
	gone := renameRow(t, db, "someone/deleted", 1, 0, day(1))
	if err := db.Create(&FollowUpSettings{SessionID: "renames", RepositoryDaysJSON: `{"metasequoiaime/MSIME-Apple":3,"metasequoiaime/msime":5,"metasequoiaime/MSIME-Web":4}`, TeamsJSON: "[]"}).Error; err != nil {
		t.Fatal(err)
	}

	var requests atomic.Int32
	gh := renamedGitHub(t, &requests)
	if err := s.reconcileRepositoryNames(ctx, gh, "renames"); err != nil {
		t.Fatal(err)
	}
	after := snapshotRenames(t, db)

	wantRepos := []string{"metasequoiaime/MSIME-Windows", "metasequoiaime/msime", "metasequoiaime/msime-backup", "metasequoiaime/msime-web", "someone/deleted"}
	sort.Strings(after.Repos)
	if len(after.Repos) != len(wantRepos) {
		t.Fatalf("repositories after the check = %v, want %v", after.Repos, wantRepos)
	}
	for i := range wantRepos {
		if after.Repos[i] != wantRepos[i] {
			t.Fatalf("repositories after the check = %v, want %v", after.Repos, wantRepos)
		}
	}
	byKey := map[string][]PullRequest{}
	for _, row := range after.Rows {
		key := row.Repo + "#" + strconv.Itoa(row.Number)
		byKey[key] = append(byKey[key], row)
	}
	three := byKey["metasequoiaime/msime#3"]
	if len(three) != 1 {
		t.Fatalf("pull request 3 is stored %d times after the merge, want once", len(three))
	}
	if three[0].ID != current.ID {
		t.Fatalf("the merge kept row %d, want %d, the one with the latest GitHub activity", three[0].ID, current.ID)
	}
	if three[0].GitHubID != 3003 {
		t.Fatalf("the survivor's GitHub id = %d, want the 3003 a merged copy carried", three[0].GitHubID)
	}
	if three[0].URL != "https://github.com/metasequoiaime/msime/pull/3" {
		t.Fatalf("survivor URL = %q", three[0].URL)
	}
	five := byKey["metasequoiaime/msime#5"]
	if len(five) != 1 || five[0].ID != onlyOld.ID || five[0].URL != "https://github.com/metasequoiaime/msime/pull/5" {
		t.Fatalf("pull request 5, seen only under the oldest name, = %+v", five)
	}
	if !five[0].UpdatedAt.Equal(day(1)) {
		t.Fatalf("a rename moved updated_at to %s; it is GitHub activity time and must stay %s", five[0].UpdatedAt, day(1))
	}
	if web := byKey["metasequoiaime/msime-web#1"]; len(web) != 1 {
		t.Fatalf("the case-only rename left %d rows for pull request 1", len(web))
	}
	if client := byKey["metasequoiaime/msime-backup#2"]; len(client) != 1 || client[0].URL != "https://github.com/metasequoiaime/msime-backup/pull/2" {
		t.Fatalf("MSIME-Client was not moved to msime-backup: %+v", client)
	}
	if w := byKey["metasequoiaime/MSIME-Windows#9"]; len(w) != 1 || w[0].ID != windows.ID || w[0].URL != windows.URL {
		t.Fatalf("a repository that kept its name was touched: %+v", w)
	}
	if g := byKey["someone/deleted#1"]; len(g) != 1 || g[0].ID != gone.ID {
		t.Fatalf("a repository GitHub no longer has was touched: %+v", g)
	}
	for _, id := range []uint{frozen.ID, middle.ID} {
		for _, row := range after.Rows {
			if row.ID == id {
				t.Fatalf("stale copy %d of pull request 3 survived the merge", id)
			}
		}
	}

	followsOf := map[uint][]FollowUp{}
	for _, follow := range after.Follows {
		followsOf[follow.PullRequestID] = append(followsOf[follow.PullRequestID], follow)
	}
	if f := followsOf[current.ID]; len(f) != 1 || f[0].ID != kept.ID {
		t.Fatalf("pull request 3 follow-ups = %+v, want only the survivor's own", f)
	}
	if f := followsOf[onlyOld.ID]; len(f) != 1 || f[0].ID != onlyOldFollow.ID || f[0].SnoozedUntil == nil {
		t.Fatalf("pull request 5 lost its follow-up or its reminder: %+v", f)
	}
	if after.Events != 2 {
		t.Fatalf("follow-up events = %d, want 2: the dropped follow-up's event goes with it and the rest stay", after.Events)
	}
	var threeComments []uint64
	for _, comment := range after.Comments {
		if comment.PullRequestID == current.ID {
			threeComments = append(threeComments, comment.GitHubID)
		}
	}
	if len(threeComments) != 2 || threeComments[0] != 10 || threeComments[1] != 11 {
		t.Fatalf("pull request 3 comments = %v, want 10 and 11 once each", threeComments)
	}
	if len(after.Comments) != 3 {
		t.Fatalf("comments after the merge = %d, want 3 (10 and 11 on #3, 20 moved to msime-web #1)", len(after.Comments))
	}
	if after.Days["metasequoiaime/msime"] != 5 || after.Days["metasequoiaime/msime-web"] != 4 {
		t.Fatalf("waiting periods after the rename = %v; the new name's own value stands and an old-only one moves", after.Days)
	}
	if _, stale := after.Days["metasequoiaime/MSIME-Apple"]; stale {
		t.Fatalf("the old name's waiting period was left behind: %v", after.Days)
	}

	// Within the interval nothing is asked again; past it, the same answers change nothing.
	asked := requests.Load()
	if err := s.reconcileRepositoryNames(ctx, gh, "renames"); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != asked {
		t.Fatalf("a second check within the interval asked GitHub %d more times", requests.Load()-asked)
	}
	if err := db.Model(&PullRequest{}).Where("session_id = ?", "renames").UpdateColumn("repo_name_checked_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.reconcileRepositoryNames(ctx, gh, "renames"); err != nil {
		t.Fatal(err)
	}
	again := snapshotRenames(t, db)
	first, _ := json.Marshal(after)
	second, _ := json.Marshal(again)
	if string(first) != string(second) {
		t.Fatalf("a second pass changed the data:\n%s\n%s", first, second)
	}
}

func renamedIssue(id int64, number int, repo string) *github.Issue {
	updated := github.Timestamp{Time: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)}
	return &github.Issue{
		ID:            github.Ptr(id),
		Number:        github.Ptr(number),
		Title:         github.Ptr("renamed"),
		State:         github.Ptr("open"),
		HTMLURL:       github.Ptr("https://github.com/" + repo + "/pull/" + strconv.Itoa(number)),
		RepositoryURL: github.Ptr("https://api.github.com/repos/" + repo),
		UpdatedAt:     &updated,
		CreatedAt:     &updated,
		User:          &github.User{Login: github.Ptr("houko")},
	}
}

func renamedRows(t *testing.T, db *gorm.DB) []PullRequest {
	t.Helper()
	var rows []PullRequest
	if err := db.Where("session_id = ?", "renames").Order("number, id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

// A pull request the sync already holds by id, returned under another repository name, is updated where it is and not stored again. Which name is current is left to the repository endpoint: both names are marked for the name check, and at the start of the next sync every row of the old name moves.
func TestSyncMeetingAKnownPullRequestUnderANewNameLeavesTheRenameToTheNameCheck(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	ctx := context.Background()
	old := "yldm-tech/Old-Name"
	renameRow(t, db, old, 4, 77, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	sibling := renameRow(t, db, old, 6, 0, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	if err := db.Model(&PullRequest{}).Where("session_id = ?", "renames").UpdateColumn("repo_name_checked_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.saveHistoryPage(ctx, "renames", []*github.Issue{renamedIssue(77, 4, "yldm-tech/new-name")}); err != nil {
		t.Fatal(err)
	}
	rows := renamedRows(t, db)
	if len(rows) != 2 {
		t.Fatalf("rows after the sync = %d, want 2: the known pull request is updated, not stored again", len(rows))
	}
	if rows[0].Title != "renamed" || rows[0].Repo != old || rows[0].URL != "https://github.com/yldm-tech/Old-Name/pull/4" {
		t.Fatalf("the pull request the sync met = %+v, want its new title under the name it was stored with", rows[0])
	}
	for _, row := range rows {
		if row.RepoNameCheckedAt != nil {
			t.Fatalf("row %d was not marked for the name check", row.Number)
		}
	}

	var requests atomic.Int32
	if err := s.reconcileRepositoryNames(ctx, renamedGitHub(t, &requests), "renames"); err != nil {
		t.Fatal(err)
	}
	rows = renamedRows(t, db)
	if len(rows) != 2 || rows[0].URL != "https://github.com/yldm-tech/new-name/pull/4" || rows[1].ID != sibling.ID || rows[1].URL != "https://github.com/yldm-tech/new-name/pull/6" {
		t.Fatalf("rows after the name check = %+v, want both moved to yldm-tech/new-name", rows)
	}
}

// The pull request's id can sit on the older of two copies: the row under the old name, with a later copy stored under the new name before ids were kept. The name check folds them into one row that carries the id and the sync's latest write.
func TestNameCheckFoldsTheCopyTheSyncWroteThroughIntoOneRow(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	ctx := context.Background()
	renameRow(t, db, "yldm-tech/Old-Name", 4, 77, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	renameRow(t, db, "yldm-tech/new-name", 4, 0, time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
	if err := s.saveHistoryPage(ctx, "renames", []*github.Issue{renamedIssue(77, 4, "yldm-tech/new-name")}); err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	if err := s.reconcileRepositoryNames(ctx, renamedGitHub(t, &requests), "renames"); err != nil {
		t.Fatal(err)
	}
	rows := renamedRows(t, db)
	if len(rows) != 1 || rows[0].GitHubID != 77 || rows[0].Title != "renamed" || rows[0].URL != "https://github.com/yldm-tech/new-name/pull/4" {
		t.Fatalf("rows after the name check = %+v, want one row carrying id 77, the sync's title and the new URL", rows)
	}
}

// Search results can carry a repository's old name for a while after a rename. A row already under the current name must not be moved back by them.
func TestAStaleNameInSearchResultsDoesNotMoveARowBack(t *testing.T) {
	db := integrationDB(t)
	s := &Server{db: db}
	ctx := context.Background()
	current := renameRow(t, db, "yldm-tech/new-name", 4, 77, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	if err := s.saveHistoryPage(ctx, "renames", []*github.Issue{renamedIssue(77, 4, "yldm-tech/Old-Name")}); err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	if err := s.reconcileRepositoryNames(ctx, renamedGitHub(t, &requests), "renames"); err != nil {
		t.Fatal(err)
	}
	rows := renamedRows(t, db)
	if len(rows) != 1 || rows[0].ID != current.ID || rows[0].Repo != "yldm-tech/new-name" || rows[0].URL != current.URL || rows[0].Title != "renamed" {
		t.Fatalf("rows after a stale search result = %+v, want the row kept under yldm-tech/new-name with the new title", rows)
	}
}

// Two rows under one number whose GitHub ids differ are two pull requests: a renamed repository that took a deleted one's name must not fold the deleted repository's pull request into its own.
func TestRenameKeepsPullRequestsWithDifferentGitHubIDsApart(t *testing.T) {
	db := integrationDB(t)
	old := renameRow(t, db, "yldm-tech/tool", 1, 11, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	moved := renameRow(t, db, "yldm-tech/tool2", 1, 22, time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
	if err := db.Transaction(func(tx *gorm.DB) error { return renameRepository(tx, "renames", "yldm-tech/tool2", "yldm-tech/tool") }); err != nil {
		t.Fatal(err)
	}
	var rows []PullRequest
	if err := db.Where("session_id = ?", "renames").Order("id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].ID != old.ID || rows[0].GitHubID != 11 || rows[1].ID != moved.ID || rows[1].GitHubID != 22 {
		t.Fatalf("rows after the rename = %+v, want both pull requests kept with their own ids", rows)
	}
}
