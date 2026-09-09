SCRIPTS = ./dev-scripts

.PHONY: all
all: build lint typecheck test

.PHONY: build
build:
	bun install --frozen-lockfile
	uv sync

.PHONY: lint
lint: lint-docs lint-dist lint-shell lint-secrets lint-workflows

.PHONY: lint-docs
lint-docs:
	$(SCRIPTS)/lint-docs.sh

.PHONY: lint-dist
lint-dist:
	$(SCRIPTS)/lint-dist.sh

.PHONY: lint-shell
lint-shell:
	$(SCRIPTS)/lint-shell-scripts.sh

.PHONY: lint-secrets
lint-secrets:
	gitleaks git --pre-commit --redact --staged --no-banner

.PHONY: lint-workflows
lint-workflows:
	actionlint --oneline

.PHONY: lint-commit-msg
lint-commit-msg:
	$(SCRIPTS)/lint-commit-message.sh

.PHONY: dist
dist:
	$(SCRIPTS)/build-dist.sh

.PHONY: test
test:
	bun test

.PHONY: typecheck
typecheck:
	bunx tsc --noEmit

.PHONY: docs
docs:
	$(SCRIPTS)/update-docs.sh

.PHONY: install-tools
install-tools:
	mise install
	brew install shellcheck

.PHONY: clean
clean:
	rm -rf dist

.PHONY: clean-all
clean-all:
	rm -rf node_modules
	rm -rf .venv

.PHONY: upgrade-deps
upgrade-deps:
	npm run upgrade-deps
