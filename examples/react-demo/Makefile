# Example-app targets. Repo-wide flows live in the root Makefile.
.DEFAULT_GOAL := help

# ---------- Run ----------

dev: ## Run the app in dev mode (Vite dev server)
	npm run dev

start: dev ## Alias for dev

build: ## Production build
	npm run build

preview: ## Preview the production build
	npm run preview

# ---------- Quality ----------

test: ## Unit tests (Vitest)
	npm test

coverage: ## Unit tests with coverage (floors enforced; E2E is the real coverage)
	npm run test:coverage

typecheck: ## tsc --noEmit
	npm run typecheck

e2e: ## Playwright browser E2E (needs the test DB: make test-db-up at repo root)
	npm run test:e2e

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: dev start build preview test coverage typecheck e2e help
