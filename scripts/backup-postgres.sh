#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
out="${1:-pr-dashboard-$(date -u +%Y%m%dT%H%M%SZ).dump}"
umask 077
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$out"
printf 'backup written to %s\n' "$out"
