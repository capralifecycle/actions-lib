SCRIPTS = ./dev-scripts

.PHONY: all
all: build lint typecheck test

# The single entry point CI uses: everything `all` does, with the lockfile
# frozen, and then a check that none of it changed a tracked file. The bundles
# and the README table are generated and committed, so a build that rewrites one
# is a build running from something the repository does not contain.
#
# Only changes the build itself made count, so this stays usable with work in
# progress in the tree. The diff is hashed as well as the status, because
# rewriting a file that is already modified leaves its status line unchanged.
.PHONY: ci
ci:
	@before="$$(git status --porcelain; git diff | git hash-object --stdin)"; \
	$(MAKE) all INSTALL_FLAGS=--frozen-lockfile || exit 1; \
	after="$$(git status --porcelain; git diff | git hash-object --stdin)"; \
	if [ "$$before" != "$$after" ]; then \
		echo "" >&2; \
		echo "The build changed tracked files:" >&2; \
		git status --short >&2; \
		echo "" >&2; \
		echo "Run 'make' and commit the result." >&2; \
		exit 1; \
	fi

# A local build may update the lockfile; CI passes --frozen-lockfile so that it
# cannot.
INSTALL_FLAGS ?=

.PHONY: build
build: install dist docs

.PHONY: install
install:
	bun install $(INSTALL_FLAGS)

.PHONY: lint
lint: lint-shell lint-secrets lint-workflows

.PHONY: lint-docs
lint-docs:
	bun $(SCRIPTS)/generate-docs.ts --check

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
