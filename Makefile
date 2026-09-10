.PHONY: db api web production backup test
db:
	docker compose up -d postgres
api:
	cd apps/api && go run .
web:
	cd frontend && bun run dev
production:
	docker compose up -d --build api postgres
	WEB_PORT=$${WEB_PORT:-5174} docker compose --profile production up -d --build web
backup:
	./scripts/backup-postgres.sh $${BACKUP_FILE:-pr-dashboard-$$(date -u +%Y%m%dT%H%M%SZ).dump}
test:
	cd apps/api && go test ./...
	cd frontend && bun run test && bun run build
