package main

import (
	"strings"
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
	// rollout meets a schema that is behind the binary, so the schema is put behind
	// on purpose: a column dropped and both indexes dropped, under live rows.
	if err := db.Migrator().DropColumn(&PullRequest{}, "role"); err != nil {
		t.Fatal("could not regress the schema:", err)
	}
	if db.Migrator().HasColumn(&PullRequest{}, "role") {
		t.Fatal("the column was not actually dropped, so the migration has nothing to add back")
	}
	// Each name is asserted to exist before it is dropped: an index the schema
	// never had makes this a no-op that only looks like a regression.
	// pr_session_url is the composite the per-pull-request sync lookup needs;
	// oauth_github_account is partial and is created by raw SQL guarded with IF NOT
	// EXISTS, so without dropping it the two accounts above are never indexed by
	// the migration under test. DROP INDEX is issued directly because the driver's
	// Migrator.DropIndex qualifies the name with a literal CURRENT_SCHEMA, which
	// PostgreSQL rejects; the fixture's search_path makes the bare name unambiguous.
	for _, index := range []struct {
		model any
		name  string
	}{{&PullRequest{}, "pr_session_url"}, {&OAuthToken{}, "oauth_github_account"}} {
		if !db.Migrator().HasIndex(index.model, index.name) {
			t.Fatal("the schema never had " + index.name + ", so dropping it regresses nothing")
		}
		if err := db.Exec("DROP INDEX " + index.name).Error; err != nil {
			t.Fatal("could not regress the schema:", err)
		}
		if db.Migrator().HasIndex(index.model, index.name) {
			t.Fatal(index.name + " was not actually dropped")
		}
	}
	// A database deployed before pr_session_url existed carries a standalone index on
	// session_id, which the composite now supersedes. AutoMigrate never drops
	// anything, so it is put back here: unless the migration removes it by name it
	// outlives the model that stopped asking for it.
	superseded := db.NamingStrategy.IndexName(db.NamingStrategy.TableName("PullRequest"), "session_id")
	if err := db.Exec("CREATE INDEX IF NOT EXISTS " + superseded + " ON " + db.NamingStrategy.TableName("PullRequest") + " (session_id)").Error; err != nil {
		t.Fatal("could not restore the superseded index:", err)
	}
	if !db.Migrator().HasIndex(&PullRequest{}, superseded) {
		t.Fatal("the superseded index was not created, so its removal proves nothing")
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
	if !db.Migrator().HasIndex(&OAuthToken{}, "oauth_github_account") {
		t.Fatal("the dropped partial unique index was not rebuilt")
	}
	if db.Migrator().HasIndex(&PullRequest{}, superseded) {
		t.Fatal("the superseded single-column index on session_id outlived the migration")
	}
	// The name alone would also be satisfied by a one-column index: dropping either
	// half of the composite tag leaves an index still called pr_session_url that no
	// longer serves the session_id + url lookup it exists for, and the name itself
	// contains both words. The indexed columns are what is checked.
	var columns []string
	if err := db.Raw(`SELECT a.attname FROM pg_index i
			JOIN pg_class ic ON ic.oid = i.indexrelid
			JOIN pg_class c ON c.oid = i.indrelid
			JOIN pg_namespace n ON n.oid = ic.relnamespace
			JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
			WHERE n.nspname = current_schema() AND ic.relname = ? ORDER BY a.attname`, "pr_session_url").
		Pluck("attname", &columns).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Join(columns, ",") != "session_id,url" {
		t.Fatalf("pr_session_url covers %v, not session_id and url", columns)
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
