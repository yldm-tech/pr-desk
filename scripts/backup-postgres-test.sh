#!/usr/bin/env sh
# Runs backup-postgres.sh against stub pg_dump/pg_restore on PATH. A run that fails anywhere must leave the backup already sitting at the target path untouched and must not leave bytes behind that a later restore would mistake for a dump.
set -eu

dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
script="$dir/backup-postgres.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
failures=0

fail() {
	printf 'not ok - %s\n' "$1"
	failures=$((failures + 1))
}

expect_content() {
	actual=$(cat "$1" 2>/dev/null || printf '<missing>')
	[ "$actual" = "$2" ] || fail "$3: expected '$2' in $1, found '$actual'"
}

mkdir "$work/bin"
# The stub writes before exiting so the failing cases reproduce the real hazard: bytes on disk that are not a restorable archive.
cat > "$work/bin/pg_dump" <<'STUB'
#!/usr/bin/env sh
printf 'fresh-dump'
exit "${STUB_PG_DUMP_EXIT:-0}"
STUB
cat > "$work/bin/pg_restore" <<'STUB'
#!/usr/bin/env sh
exit "${STUB_PG_RESTORE_EXIT:-0}"
STUB
chmod 0755 "$work/bin/pg_dump" "$work/bin/pg_restore"
PATH="$work/bin:$PATH"
export PATH
DATABASE_URL='host=stub'
export DATABASE_URL

out="$work/pr-dashboard.dump"

printf 'good-backup' > "$out"
if STUB_PG_DUMP_EXIT=1 sh "$script" "$out" > "$work/run.log" 2>&1; then
	fail 'failing pg_dump: script reported success'
fi
expect_content "$out" 'good-backup' 'failing pg_dump'
[ ! -e "$out.partial" ] || fail 'failing pg_dump: left a partial file behind'

printf 'good-backup' > "$out"
if STUB_PG_RESTORE_EXIT=1 sh "$script" "$out" > "$work/run.log" 2>&1; then
	fail 'unreadable dump: script reported success'
fi
expect_content "$out" 'good-backup' 'unreadable dump'
[ ! -e "$out.partial" ] || fail 'unreadable dump: left a partial file behind'

if sh "$script" "$out" > "$work/run.log" 2>&1; then
	expect_content "$out" 'fresh-dump' 'successful dump'
	grep -q "backup written to $out" "$work/run.log" || fail 'successful dump: no success line'
else
	fail 'successful dump: script exited nonzero'
fi
[ ! -e "$out.partial" ] || fail 'successful dump: left a partial file behind'

[ "$failures" -eq 0 ] || exit 1
printf 'ok - backup-postgres.sh keeps the previous backup when a run fails\n'
