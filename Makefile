VENV = .venv/bin
SCRIPTS = ./dev-scripts

.PHONY: all check venv update-docs

all: check

check:
	npm install
	$(SCRIPTS)/check-docs.sh
	$(SCRIPTS)/lint-modified-shell-scripts.sh

venv:
	python -m venv .venv; \
	$(VENV)/pip install -r requirements.txt

update-docs:
	$(SCRIPTS)/update-docs.sh
