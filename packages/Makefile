# Fans common targets out to every package (auto-discovered by Makefile).
.DEFAULT_GOAL := help

SUBDIRS := $(patsubst %/Makefile,%,$(wildcard */Makefile))

test: ## Unit tests in every package
coverage: ## Coverage in every package (100% baseline)
typecheck: ## tsc --noEmit in every package
build: ## Build every publishable package
codegen: ## Regenerate types in every package (from apps/api/schema.graphql)
clean: ## Remove build output in every package

test coverage typecheck build codegen clean:
	@for d in $(SUBDIRS); do \
		echo "── $$d ──"; \
		$(MAKE) -C $$d $@ || exit 1; \
	done

help: ## List targets (packages: $(SUBDIRS))
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: test coverage typecheck build codegen clean help
