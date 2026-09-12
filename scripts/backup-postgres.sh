#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
out="${1:-pr-dashboard-$(date -u +%Y%m%dT%H%M%SZ).dump}"
umask 077
# The shell truncates the redirect target before pg_dump even connects, so dumping straight into $out destroys the previous backup on every failed run. Stage beside it instead: a rename is only atomic within one file system.
partial="$out.partial"
trap 'rm -f "$partial"' EXIT INT TERM
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$partial"
# A half-written custom-format archive is indistinguishable from a good one until someone needs it; reading its table of contents is what proves it restorable before it replaces the previous backup.
pg_restore --list "$partial" >/dev/null
mv -f "$partial" "$out"
printf 'backup written to %s\n' "$out"
