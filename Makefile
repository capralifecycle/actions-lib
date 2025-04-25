VENV = .venv/bin
SCRIPTS = ./dev-scripts
.PHONY: all
all: check

.PHONY: check
check:
	npm install
	$(SCRIPTS)/check-docs.sh
	$(SCRIPTS)/lint-modified-shell-scripts.sh

.PHONY: venv
venv:
	python -m venv .venv; \
	$(VENV)/pip install -r requirements.txt

.PHONY: update-docs
update-docs:
	$(SCRIPTS)/update-docs.sh
