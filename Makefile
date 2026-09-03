# Development entry points - thin wrappers over the npm workspace scripts
# (house convention, see e.g. blink-mobile's Makefile).
# Run `make` or `make help` to list targets.

.DEFAULT_GOAL := help

# ---------- Setup ----------

install: ## Install all workspaces (npm ci; also installs git hooks via lefthook)
	npm ci

hooks: ## (Re)install the lefthook git hooks
	npx lefthook install

pods: ## Install iOS CocoaPods (example app)
	cd examples/react-native-demo && bundle install && cd ios && bundle exec pod install

# ---------- Quality gates ----------

unit: ## Run all unit test suites (libraries, example apps, backend)
	npm test

coverage: ## Run test suites with coverage (100% enforced on packages + backend)
	npm run test:coverage

coverage-badge: ## Render the README coverage badge from the last `make coverage` run (packages + backend)
	npm run coverage:badge

typecheck: ## TypeScript across all workspaces
	npm run typecheck

lint: ## ESLint (mobile code) + Biome lint (backend)
	npm run lint

format: ## Format everything with Biome
	npm run format

format-check: ## Check formatting without writing
	npm run format:check

check-code: lint typecheck format-check ## Lint + typecheck + format check

shellcheck: ## shellcheck every repo shell script (scripts/**)
	shellcheck -x scripts/*.sh scripts/*/*.sh

check-ci: shellcheck ## Lint the CI itself: actionlint (workflows) + shellcheck (scripts)
	actionlint

codegen-check: ## Fail if schema.graphql / generated client code are stale (what CI runs)
	bash scripts/ci/codegen-check.sh

test: unit check-code ## Unit tests + code checks

build: ## Build the libraries (bob + tsup)
	npm run build

codegen: ## Regenerate schema.graphql + client types from the backend SDL
	npm run codegen

diagrams-check: ## Fail if docs/diagrams/README.md is stale relative to src/*.mmd (what CI runs)
	bash scripts/ci/diagrams-check.sh

docs-check: ## Warn when architecture-relevant changes (vs origin/main) ship without a docs/ update; fail on stale diagram SVGs
	bash scripts/ci/docs-freshness.sh

release: ## Cut a stable release: make release V=X.Y.Z (the tag is the version; CI publishes @latest)
	@test -n "$(V)" || { echo "usage: make release V=X.Y.Z"; exit 1; }
	gh release create "v$(V)" --target main --title "v$(V)" --generate-notes

version: ## Show what CI would publish for HEAD (prerelease), or for a tag: make version TAG=vX.Y.Z
	@DRY_RUN=1 EVENT=$(if $(TAG),release,push) TAG=$(TAG) bash scripts/release/resolve-version.sh

registry-smoke: ## Install a published version from GitHub Packages and assert the consumer contract: make registry-smoke V=X.Y.Z
	@test -n "$(V)" || { echo "usage: make registry-smoke V=X.Y.Z"; exit 1; }
	bash scripts/release/registry-smoke.sh "$(V)"

diagrams: ## Render docs/diagrams/dist/*.svg from src/*.mmd (pinned mermaid-cli) + reassemble the combined doc
	for f in docs/diagrams/src/*.mmd; do \
		npx --yes @mermaid-js/mermaid-cli@11.16.0 -i "$$f" \
			-o "docs/diagrams/dist/$$(basename "$$f" .mmd).svg" \
			--backgroundColor white --quiet || exit 1; \
	done
	node scripts/assemble-diagrams.mjs

# ---------- Run ----------

start: ## Metro bundler for the example app
	npm start

ios: ## Run the example app on the iOS simulator
	npm run ios

android: ## Run the example app on an Android emulator
	npm run android

backend: ## Backend dev server (tsx watch; env via direnv/.env)
	npm run backend

web: ## Vite dev server for the web example app
	npm run web

# ---------- Database ----------

db-up: ## Start the dev Postgres (apps/api/docker-compose.yml, port 5432)
	cd apps/api && docker compose up -d --wait

db-down: ## Stop the dev Postgres
	cd apps/api && docker compose down

migrate: ## Apply Knex migrations to the dev database
	npm run migrate -w apps/api

# ---------- E2E ----------

test-db-up: ## Start the E2E Postgres (tmpfs, port 5433) and wait for it
	docker compose -f docker-compose.test.yml up -d --wait
	bash scripts/e2e/db-wait.sh

test-db-down: ## Stop the E2E Postgres
	docker compose -f docker-compose.test.yml down

e2e-backend: test-db-up ## Backend E2E suite against real Postgres (then tears DB down)
	npm run migrate:test -w apps/api
	npm run test:e2e -w apps/api
	$(MAKE) test-db-down

e2e-web: test-db-up ## Playwright browser E2E for the web demo (proxy mode; then tears DB down)
	npm run migrate:test -w apps/api
	npm run test:e2e -w examples/react-demo
	$(MAKE) test-db-down

e2e-web-webform: test-db-up ## Playwright browser E2E for the web demo in DocuSign Web Forms mode
	npm run migrate:test -w apps/api
	npm run test:e2e:webform -w examples/react-demo
	$(MAKE) test-db-down

e2e-web-publicurl: test-db-up ## Playwright browser E2E for the web demo in public-URL mode
	npm run migrate:test -w apps/api
	npm run test:e2e:publicurl -w examples/react-demo
	$(MAKE) test-db-down

e2e-backend-up: ## Start the backend (mock provider) in the background for mobile E2E, wait for /health
	bash scripts/e2e/backend-up.sh

e2e-backend-down: ## Stop the backend started by e2e-backend-up
	bash scripts/e2e/backend-down.sh

ios-build: ## Debug build of the RN demo for the simulator (what CI's Build iOS job runs; needs `make pods`)
	bash scripts/e2e/ios-build.sh

e2e-ios: ## Maestro E2E, iOS (needs: booted simulator with the app installed, Metro + backend running)
	bash scripts/e2e/ios-maestro.sh

e2e-android: ## Maestro E2E, Android (needs: emulator, debug APK built, Metro + backend running)
	bash scripts/e2e/android-maestro.sh

test-live: ## Live verification against real DocuSign (skips unless DOCUSIGN_* set in apps/api/.env)
	npm run test:live -w apps/api

# ---------- Housekeeping ----------

clean: ## Remove build output and caches (library lib/, coverage)
	npm run clean -w packages/esign-react-native -w packages/esign-react
	rm -rf coverage packages/*/coverage examples/*/coverage apps/api/coverage

reset: ## Full dependency reinstall (root lockfile only)
	rm -rf node_modules package-lock.json
	npm install

help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: install hooks pods release version registry-smoke unit coverage coverage-badge typecheck lint format format-check check-code \
	shellcheck check-ci codegen-check test build codegen diagrams-check docs-check start ios android backend web db-up db-down migrate \
	diagrams test-db-up test-db-down e2e-backend e2e-web e2e-web-webform e2e-web-publicurl \
	e2e-backend-up e2e-backend-down ios-build e2e-ios e2e-android test-live clean reset help
