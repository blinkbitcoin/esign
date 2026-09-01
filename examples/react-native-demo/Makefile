# Example-app targets. Repo-wide flows live in the root Makefile.
.DEFAULT_GOAL := help

# ---------- Run ----------

dev: ## Run the app in dev mode (Metro bundler)
	npm start

start: dev ## Alias for dev

ios: ## Build + run on the iOS simulator
	npm run ios

android: ## Build + run on an Android emulator
	npm run android

pods: ## Install iOS native deps (bundle + pod install)
	bundle install && cd ios && bundle exec pod install

# ---------- Quality ----------

test: ## Unit tests (Jest)
	npm test

coverage: ## Unit tests with coverage (floors enforced; E2E is the real coverage)
	npm run test:coverage

typecheck: ## tsc --noEmit
	npm run typecheck

e2e: ## Maestro flows, iOS (needs backend running + app installed on a simulator)
	npm run test:e2e

e2e-android: ## Maestro flows, Android (needs backend + emulator with app installed)
	adb reverse tcp:8081 tcp:8081 && adb reverse tcp:4000 tcp:4000
	npm run test:e2e:android

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: dev start ios android pods test coverage typecheck e2e e2e-android help
