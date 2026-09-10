.PHONY: db api web build production backup test
db:
	docker compose up -d postgres
api:
	cd apps/api && go run .
web:
	cd apps/web && bun run dev
build:
	bun run build
	bun run scripts/embed-web.ts
	cd apps/api && go build -tags webembed -trimpath -o ../../dist/pr-desk .
production:
	docker compose up -d --build api postgres
backup:
	./scripts/backup-postgres.sh $${BACKUP_FILE:-pr-dashboard-$$(date -u +%Y%m%dT%H%M%SZ).dump}
test:
	cd apps/api && go test ./...
	cd apps/web && bun run test && bun run build
