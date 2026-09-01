# Service-local targets (env via direnv/.env). Repo-wide flows live in the
# root Makefile.
.DEFAULT_GOAL := help

dev: ## Dev server (tsx watch)
	npm run dev

test: ## Unit tests (Vitest)
	npm test

coverage: ## Unit tests with coverage
	npm test -- --coverage

test-watch: ## Vitest watch mode
	npm run test:watch

db-up: ## Start the dev Postgres (port 5432)
	docker compose up -d --wait

db-down: ## Stop the dev Postgres
	docker compose down

migrate: ## Apply Knex migrations (dev database)
	npm run migrate

migrate-test: ## Apply migrations to the test database (.env.test)
	npm run migrate:test

e2e: ## E2E tests against the test database (start it from repo root: make test-db-up)
	npm run test:e2e

test-live: ## Live check against real DocuSign Web Forms (needs DOCUSIGN_* in .env; skips without)
	npm run test:live

schema-emit: ## Regenerate schema.graphql from src/typeDefs.ts
	npm run schema:emit

typecheck: ## tsc --noEmit
	npm run typecheck

lint: ## Biome lint
	npm run lint

format: ## Biome format
	npm run format

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: dev test coverage test-watch db-up db-down migrate migrate-test e2e test-live schema-emit typecheck lint format help
