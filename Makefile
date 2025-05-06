SCRIPTS = ./dev-scripts

.PHONY: all
all: build lint

.PHONY: build
build:
	npm install
	uv sync

.PHONY: lint
lint: lint-docs lint-shell lint-secrets lint-workflows

.PHONY: lint-docs
lint-docs:
	$(SCRIPTS)/lint-docs.sh

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

.PHONY: update-docs
update-docs:
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
