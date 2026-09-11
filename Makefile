# Development entry points - thin wrappers over the npm workspace scripts
# (house convention, see e.g. blink-mobile's Makefile).
# Run `make` or `make help` to list targets.

.DEFAULT_GOAL := help
# The platform e2e-metro-up prewarms the bundle for (metro-wait.sh)
METRO_PLATFORM ?= ios

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

coverage: ## Run test suites with coverage (100% enforced on packages + backend + scripts/lib); fail on rows with nothing to cover
	npm run test:coverage
	node scripts/ci/coverage-empty.mjs

coverage-badge: ## Render the README coverage badge from the last `make coverage` run (packages + backend + scripts/lib)
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
	node scripts/ci/docs-tables.mjs

codeql: ## GitHub's CodeQL analysis here (LOCAL ONLY - CI runs it on GitHub): codeql.yml's suite + inline-marker suppression, findings with rule ids in .codeql/
	bash scripts/codeql-local.sh

release: ## Merge the open release PR (release-please opens it after a feat/fix lands on main); needs one approval first
	@pr=$$(gh pr list --state open --label 'autorelease: pending' --json number,title -q '.[0] // empty | "\(.number) \(.title)"'); \
	test -n "$$pr" || { echo "no open release PR: one appears after a feat/fix/perf commit reaches main (docs/releasing.md)"; exit 1; }; \
	echo "merging #$$pr"; gh pr merge "$${pr%% *}" --squash

release-rc: ## Hand-cut a prerelease-suffixed tag that ships under next: make release-rc V=X.Y.Z-rc.1 (stable releases: make release)
	@test -n "$(V)" || { echo "usage: make release-rc V=X.Y.Z-rc.1"; exit 1; }
	@case "$(V)" in *-*) ;; *) echo "V must carry a prerelease suffix (X.Y.Z-rc.1); stable versions go through the release PR"; exit 1 ;; esac
	gh release create "v$(V)" --target main --title "v$(V)" --prerelease --notes "Prerelease $(V) - see CHANGELOG.md on main for the pending changes."

version: ## Show what CI would publish for HEAD (prerelease), or for a tag: make version TAG=vX.Y.Z
	@DRY_RUN=1 EVENT=$(if $(TAG),release,push) TAG=$(TAG) node scripts/release/resolve-version.mjs

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

backend: ## Backend dev server (tsx watch; env via direnv/.env, DATABASE_URL defaults to this worktree's dev Postgres)
	bash scripts/e2e/dev-db.sh run npm run backend

web: ## Vite dev server for the web example app
	npm run web

# ---------- Database ----------

db-up: ## Start this worktree's dev Postgres (packages/esign-service/docker-compose.yml on ESIGN_DEV_DB_PORT = ESIGN_PORT_BASE + 13, default 4113; its own compose project and volume)
	bash scripts/e2e/dev-db.sh up

db-down: ## Stop this worktree's dev Postgres
	bash scripts/e2e/dev-db.sh down

migrate: ## Apply Knex migrations to the dev database (DATABASE_URL from .env, else this worktree's dev Postgres)
	bash scripts/e2e/dev-db.sh run npm run migrate -w packages/esign-service

# ---------- E2E ----------

test-db-up: ## Start the E2E Postgres (tmpfs, ESIGN_TEST_DB_PORT = ESIGN_PORT_BASE + 12, default 4112) and wait for it
	bash scripts/e2e/test-db.sh up

test-db-down: ## Stop the E2E Postgres
	bash scripts/e2e/test-db.sh down

e2e-backend: test-db-up ## Backend E2E suite against real Postgres (then tears DB down)
	bash scripts/e2e/test-db.sh run npm run migrate:test -w packages/esign-service
	bash scripts/e2e/test-db.sh run npm run test:e2e -w packages/esign-service
	$(MAKE) test-db-down

e2e-web: test-db-up build ## Playwright browser E2E for the web demo (proxy mode; then tears DB down) - builds the libraries first (the demo bundles their dist)
	bash scripts/e2e/test-db.sh run npm run migrate:test -w packages/esign-service
	npm run test:e2e -w examples/react-demo
	$(MAKE) test-db-down

e2e-web-webform: test-db-up build ## Playwright browser E2E for the web demo in DocuSign Web Forms mode - builds the libraries first (the demo bundles their dist)
	bash scripts/e2e/test-db.sh run npm run migrate:test -w packages/esign-service
	npm run test:e2e:webform -w examples/react-demo
	$(MAKE) test-db-down

e2e-web-publicurl: test-db-up build ## Playwright browser E2E for the web demo in public-URL mode - builds the libraries first (the demo bundles their dist)
	bash scripts/e2e/test-db.sh run npm run migrate:test -w packages/esign-service
	npm run test:e2e:publicurl -w examples/react-demo
	$(MAKE) test-db-down

e2e-server-demos: ## Boot the mint-only + serverless examples (mock provider) and call their routes
	bash scripts/e2e/server-demos-smoke.sh

e2e-web-webform-live: ## Playwright against a REAL DocuSign Web Form (opt-in via E2E_LIVE_* env, see docs/integration/webforms.md)
	npm run test:e2e:webform:live -w examples/react-demo

e2e-backend-up: ## Start the backend (mock provider) in the background for mobile E2E, wait for /health
	bash scripts/e2e/backend-up.sh

e2e-backend-down: ## Stop the backend started by e2e-backend-up
	bash scripts/e2e/backend-down.sh

e2e-metro-up: ## Start Metro for the RN demo in the background (proxy mode) and prewarm the bundle (METRO_PLATFORM=ios|android, default ios)
	bash scripts/e2e/metro-start.sh
	bash scripts/e2e/metro-wait.sh $(METRO_PLATFORM)

e2e-metro-down: ## Stop the Metro started by e2e-metro-up
	bash scripts/e2e/metro-down.sh

ios-build: ## Debug build of the RN demo for the simulator (what CI's Build iOS job runs; needs `make pods`)
	bash scripts/e2e/ios-build.sh

android-build: ## Debug APK of the RN demo for the attached emulator's ABI (what CI's Build Android job runs; ANDROID_ABI overrides)
	bash scripts/e2e/android-build.sh

e2e-ios: ## Maestro E2E, iOS (needs: booted simulator with the app installed, Metro + backend running)
	bash scripts/e2e/ios-maestro.sh

e2e-android: ## Maestro E2E, Android (needs: emulator, debug APK built, Metro + backend running)
	bash scripts/e2e/android-maestro.sh

e2e-ios-local: ## The whole iOS stack in one command on a Mac: DB, backend, pods if missing, .app, simulator, Metro, Maestro, teardown
	bash scripts/e2e/ios-local.sh

e2e-android-local: ## The whole Android stack in one command on a laptop: DB, backend, APK, Metro, Maestro, teardown (needs a running emulator)
	bash scripts/e2e/android-local.sh

test-live: ## Live verification against real DocuSign (skips unless DOCUSIGN_* set in packages/esign-service/.env)
	npm run test:live -w packages/esign-service

docusign-env: ## Write packages/esign-service/.env for a live run (ACCOUNT_ID= INTEGRATION_KEY= USER_ID= TEMPLATE_ID= WEBFORM_ID= [PEM=] [FORCE=1])
	bash scripts/e2e/docusign-env.sh

docusign-template: ## Create (or reuse) the proxy-flow template in the DocuSign account from the fixture PDF; WRITE=1 sets DOCUSIGN_TEMPLATE_ID in .env
	npm run docusign:template -w packages/esign-service

docusign-check: ## JWT grant + fetch the configured Web Form with that .env; prints the consent URL when consent is missing
	npm run docusign:check -w packages/esign-service

e2e-live: ## Full live run: start the service on DocuSign, API live test, Playwright locked-fields check against the fixture form, stop
	bash scripts/e2e/live.sh

e2e-ios-live: ## React Native live run: service on DocuSign + Metro (webform mode) + Maestro drives the real form in the WebView to a signed envelope
	bash scripts/e2e/ios-live.sh

live-web: ## The web demo against real DocuSign, one command: .env, public URL (Tailscale Funnel), service, demo; waits for the manual rows of docs/integration/docusign-proxy.md section 5, Ctrl-C tears down
	bash scripts/e2e/live-web.sh

live-ios: ## The RN demo on the attached iPhone against real DocuSign, one command: .env, public URL, service, Metro (ESIGN_MODE=proxy|webform, ESIGN_BACKEND_HOST auto), device build (LIVE_DEVICE=<name>); waits, Ctrl-C tears down
	bash scripts/e2e/live-ios.sh

live-android: ## The RN demo on the attached Android device against real DocuSign, one command: .env, public URL, service, adb reverse, Metro (ESIGN_MODE=proxy|webform), APK for the device's ABI (LIVE_DEVICE=<serial>); waits, Ctrl-C tears down
	bash scripts/e2e/live-android.sh

# ---------- Container ----------

docker-build: ## Build the service image (packages/esign-service/Dockerfile, from the repo root)
	bash scripts/ci/docker-build.sh esign-service

docker-smoke: docker-build ## Boot the image in both modes (mint only, then with Postgres) and assert its capabilities
	bash scripts/ci/docker-smoke.sh esign-service
	$(MAKE) test-db-up
	bash scripts/e2e/test-db.sh run-docker bash scripts/ci/docker-smoke.sh esign-service
	$(MAKE) test-db-down

deploy-check: ## Validate the deploy templates (compose + the Worker bundle; k8s when kubeconform is installed)
	bash scripts/ci/deploy-check.sh

docker-build-mint-only: ## Build the mint-only demo image (examples/mint-only-demo/Dockerfile, from the repo root) - a demo, not published
	DOCKERFILE=examples/mint-only-demo/Dockerfile bash scripts/ci/docker-build.sh esign-mint-only-demo

docker-smoke-mint-only: docker-build-mint-only ## Boot the mint-only demo image with the mock provider and hit /health
	bash scripts/ci/docker-smoke.sh esign-mint-only-demo $(shell node scripts/e2e/ports.mjs mint)

# ---------- Housekeeping ----------

clean: ## Remove build output and caches (library lib/, coverage)
	npm run clean -w packages/esign-react-native -w packages/esign-react
	rm -rf coverage packages/*/coverage examples/*/coverage

reset: ## Full dependency reinstall (root lockfile only)
	rm -rf node_modules package-lock.json
	npm install

help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: install hooks pods release release-rc version registry-smoke unit coverage coverage-badge typecheck lint format format-check check-code \
	shellcheck check-ci codegen-check test build codegen diagrams-check docs-check codeql start ios android backend web db-up db-down migrate \
	diagrams test-db-up test-db-down e2e-backend e2e-web e2e-web-webform e2e-web-publicurl e2e-web-webform-live \
	e2e-server-demos e2e-backend-up e2e-backend-down e2e-metro-up e2e-metro-down ios-build android-build e2e-ios e2e-android e2e-ios-local e2e-android-local test-live docusign-env docusign-template docusign-check e2e-live e2e-ios-live live-web live-ios live-android docker-build docker-smoke docker-build-mint-only docker-smoke-mint-only deploy-check clean reset help
