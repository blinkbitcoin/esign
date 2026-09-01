# Package-local targets. Repo-wide flows live in the root Makefile.
.DEFAULT_GOAL := help

test: ## Unit tests (Jest)
	npm test

coverage: ## Unit tests with coverage (100% baseline)
	npm run test:coverage

typecheck: ## tsc --noEmit
	npm run typecheck

build: ## Build the publishable package (tsup, both entries)
	npm run build

codegen: ## Regenerate types from ../../apps/api/schema.graphql
	npm run codegen

clean: ## Remove build output
	npm run clean

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: test coverage typecheck build codegen clean help
