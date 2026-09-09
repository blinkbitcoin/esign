# Example-app targets. Repo-wide flows live in the root Makefile.
.DEFAULT_GOAL := help

dev: ## Run the API (ESIGN_PROVIDER=mock needs no credentials; PORT, default 4100)
	npm run dev

start: dev ## Alias for dev

test: ## Unit tests (Vitest)
	npm test

coverage: ## Unit tests with coverage (100% enforced)
	npm run test:coverage

typecheck: ## tsc --noEmit
	npm run typecheck

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: dev start test coverage typecheck help
