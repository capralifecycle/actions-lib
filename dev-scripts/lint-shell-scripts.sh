#!/usr/bin/env bash

# Lints shell scripts by running shellcheck on non-ignored files.

set -euo pipefail

find . \
    -name node_modules -prune -o \
    -name .git -prune -o \
    -name '*.sh' \
    -type f \
    -exec shellcheck {} +
