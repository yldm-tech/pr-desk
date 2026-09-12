package main

import (
	"testing"
	"time"
)

// Production always migrates a database that already holds data, but every
// other migration test starts from an empty schema. A migration that only
// works on a fresh database would pass all of them and fail on deploy.
func TestMigrateIsSafeOnAPopulatedDatabase(t *testing.T) {
	db := integrationDB(t)
	now := time.Now().UTC()
	pr := PullRequest{SessionID: "migrate", Repo: "fixture/repo", Number: 1, Title: "Existing row", State: "open", UpdatedAt: now, Role: "authored"}
	if err := db.Create(&pr).Error; err != nil {
		t.Fatal(err)
	}
	// gorm stamps updated_at on create with nanosecond precision that the column
	// truncates, so the row is pinned to an exact value before the comparison.
	activity := time.Date(2021, 3, 4, 5, 6, 7, 0, time.UTC)
	if err := db.Model(&PullRequest{}).Where("id = ?", pr.ID).UpdateColumn("updated_at", activity).Error; err != nil {
		t.Fatal(err)
	}
	follow := FollowUp{SessionID: "migrate", PullRequestID: pr.ID, Version: 1, WaitingSince: now, LastActivityAt: now, FactsJSON: `{"role":"authored"}`}
	if err := db.Create(&follow).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&FollowUpSettings{SessionID: "migrate", Timezone: "UTC", DigestTime: "09:00", WaitDays: 7, Language: "en", TeamsJSON: "[]", RepositoryDaysJSON: "{}"}).Error; err != nil {
		t.Fatal(err)
	}

	// Two accounts, one of them unconnected, so the partial unique index on
	// git_hub_id is built over live rows rather than an empty table.
	for _, account := range []OAuthToken{
		{SessionID: "migrate-a", GitHubID: 4242, Username: "houko", Token: "stored"},
		{SessionID: "migrate-b", GitHubID: 0, Username: "", Token: ""},
	} {
		if err := db.Create(&account).Error; err != nil {
			t.Fatal(err)
		}
	}

	// The migration has to have work to do, or re-running it proves nothing. A
	// rollout meets a schema that is behind the binary, so the schema is put
	// behind on purpose: a column dropped and an index removed, under live rows.
	if err := db.Migrator().DropColumn(&PullRequest{}, "role"); err != nil {
		t.Fatal("could not regress the schema:", err)
	}
	if db.Migrator().HasIndex(&PullRequest{}, "idx_pull_requests_url") {
		if err := db.Migrator().DropIndex(&PullRequest{}, "idx_pull_requests_url"); err != nil {
			t.Fatal("could not regress the schema:", err)
		}
	}
	if db.Migrator().HasColumn(&PullRequest{}, "role") {
		t.Fatal("the column was not actually dropped, so the migration has nothing to add back")
	}

	// Re-running the migration is what a rollout does to the live database.
	if err := migrateDatabase(db); err != nil {
		t.Fatal("migrating a populated database failed:", err)
	}
	if err := migrateDatabase(db); err != nil {
		t.Fatal("the migration is not repeatable:", err)
	}

	var survivor PullRequest
	if err := db.Where("id = ?", pr.ID).First(&survivor).Error; err != nil {
		t.Fatal("an existing row did not survive the migration:", err)
	}
	if survivor.Title != "Existing row" || !survivor.UpdatedAt.UTC().Equal(activity) {
		t.Fatal("the migration rewrote existing data", survivor.Title, survivor.UpdatedAt)
	}
	if !db.Migrator().HasColumn(&PullRequest{}, "role") {
		t.Fatal("the dropped column was not restored")
	}
	var follows int64
	db.Model(&FollowUp{}).Where("session_id = ?", "migrate").Count(&follows)
	if follows != 1 {
		t.Fatal("follow-up rows were lost", follows)
	}
	var accounts int64
	db.Model(&OAuthToken{}).Where("session_id LIKE ?", "migrate-%").Count(&accounts)
	if accounts != 2 {
		t.Fatal("account rows were lost", accounts)
	}
}

// The blank time/tzdata import in followup_settings.go is load-bearing: the
// production image is built FROM scratch-like alpine with no zoneinfo, so
// dropping it would silently break every schedule outside UTC. Nothing else
// fails if it disappears.
func TestTimezoneDatabaseIsEmbedded(t *testing.T) {
	for _, name := range []string{"Asia/Tokyo", "America/New_York", "Europe/Madrid"} {
		location, err := time.LoadLocation(name)
		if err != nil {
			t.Fatalf("%s is unavailable; the time/tzdata import was probably removed: %v", name, err)
		}
		if location.String() != name {
			t.Fatalf("%s resolved to %s", name, location)
		}
	}
	// A schedule computed in a non-UTC zone is the thing that actually breaks.
	settings := FollowUpSettings{Timezone: "Asia/Tokyo", DigestTime: "09:00"}
	if _, due := digestDue(settings, time.Date(2026, 9, 11, 0, 30, 0, 0, time.UTC)); !due {
		t.Fatal("the daily digest did not fire at 09:30 Tokyo time")
	}
}
