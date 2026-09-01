# Fans common targets out to every app (auto-discovered by Makefile).
.DEFAULT_GOAL := help

SUBDIRS := $(patsubst %/Makefile,%,$(wildcard */Makefile))

test: ## Unit tests in every app
coverage: ## Coverage in every app (100% enforced)
typecheck: ## tsc --noEmit in every app

test coverage typecheck:
	@for d in $(SUBDIRS); do \
		echo "── $$d ──"; \
		$(MAKE) -C $$d $@ || exit 1; \
	done

help: ## List targets (apps: $(SUBDIRS))
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: test coverage typecheck help
