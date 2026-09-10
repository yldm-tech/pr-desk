#!/usr/bin/env bash
# Isolated database per run/attempt, following yldm-tech/glean's runner setup.
set -euo pipefail
: "${CONTAINER:?set a unique CONTAINER name}"
case "${1:-}" in
start)
  image="${POSTGRES_IMAGE:-mirror.gcr.io/library/postgres:16-alpine}"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    for attempt in 1 2 3; do
      if docker pull --platform linux/amd64 "$image"; then break; fi
      if [ "$attempt" = 3 ]; then exit 1; fi
      sleep $((attempt * 5))
    done
  fi
  docker run -d --name "$CONTAINER" -e POSTGRES_USER=prdesk_test -e POSTGRES_PASSWORD=prdesk_test -e POSTGRES_DB=prdesk_test -p 127.0.0.1::5432 "$image"
  port=$(docker port "$CONTAINER" 5432/tcp | sed -n 's/^127\.0\.0\.1://p')
  [ -n "$port" ]
  echo "TEST_DATABASE_URL=postgres://prdesk_test:prdesk_test@127.0.0.1:${port}/prdesk_test?sslmode=disable" >> "${GITHUB_ENV:?}"
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -U prdesk_test -d prdesk_test -h 127.0.0.1 -q; then exit 0; fi
    sleep 1
  done
  docker logs "$CONTAINER"
  exit 1
  ;;
stop)
  if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker stop --time 10 "$CONTAINER"
    docker rm "$CONTAINER"
  fi
  ;;
*) echo "usage: ci-postgres.sh start|stop" >&2; exit 2 ;;
esac
