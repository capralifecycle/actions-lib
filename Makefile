SCRIPTS = ./dev-scripts

.PHONY: all
all: build lint typecheck test

# The single entry point CI uses: everything `all` does, with the lockfile
# frozen, and then a check that none of it changed a tracked file. The bundles
# and the README table are generated and committed, so a build that rewrites one
# is a build running from something the repository does not contain.
#
# Only files the build itself touched count, so this stays usable with work in
# progress in the tree.
.PHONY: ci
ci:
	@before="$$(git status --porcelain)"; \
	$(MAKE) all INSTALL_FLAGS=--frozen-lockfile || exit 1; \
	after="$$(git status --porcelain)"; \
	if [ "$$before" != "$$after" ]; then \
		echo "" >&2; \
		echo "The build changed tracked files:" >&2; \
		git status --short >&2; \
		echo "" >&2; \
		echo "Run 'make dist docs' and commit the result." >&2; \
		exit 1; \
	fi

# A local build may update the lockfile; CI passes --frozen-lockfile so that it
# cannot.
INSTALL_FLAGS ?=

.PHONY: build
build:
	bun install $(INSTALL_FLAGS)

.PHONY: lint
lint: lint-docs lint-dist lint-shell lint-secrets lint-workflows

.PHONY: lint-docs
lint-docs:
	bun $(SCRIPTS)/generate-docs.ts --check

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
	bun $(SCRIPTS)/generate-docs.ts

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

.PHONY: upgrade-deps
upgrade-deps:
	npm run upgrade-deps
