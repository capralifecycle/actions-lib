VENV = .venv/bin
SCRIPTS = ./dev-scripts

.PHONY: all
all: build lint

.PHONY: build
build:
	npm install

.PHONY: lint
lint:
	$(SCRIPTS)/check-docs.sh
	$(SCRIPTS)/lint-shell-scripts.sh

.PHONY: update-docs
update-docs:
	$(SCRIPTS)/update-docs.sh

.PHONY: setup-venv
setup-venv:
	python -m venv .venv; \
	$(VENV)/pip install -r requirements.txt
