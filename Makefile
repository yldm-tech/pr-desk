.PHONY: db api web build cli install-cli production backup test
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
cli:
	cd apps/api && go build -trimpath -o ../../dist/prdesk ./cmd/prdesk
# Installs what this checkout builds, which reports "dev". Use scripts/install-cli.sh
# for a released binary that reports its version.
install-cli: cli
	install -d $${PRDESK_INSTALL_DIR:-$$HOME/.local/bin}
	install -m 0755 dist/prdesk $${PRDESK_INSTALL_DIR:-$$HOME/.local/bin}/prdesk
production:
	docker compose up -d --build api postgres
backup:
	./scripts/backup-postgres.sh $${BACKUP_FILE:-pr-dashboard-$$(date -u +%Y%m%dT%H%M%SZ).dump}
test:
	cd apps/api && go test ./...
	cd apps/web && bun run test && bun run build
	./scripts/backup-postgres-test.sh
