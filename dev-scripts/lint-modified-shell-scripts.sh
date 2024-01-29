#!/usr/bin/env bash

# Lint modified shell scripts with shellcheck (poor man's lint-staged).
# - Includes modified scripts (added, modified, renamed)
# - Ignores untracked scripts

project_root=$(git rev-parse --show-toplevel)
scripts=$(git diff --name-only --diff-filter=AMR HEAD | awk '!seen[$0]++' | grep "\.sh$")

for script in $scripts; do
  shellcheck "${project_root}/${script}"
done
