#!/usr/bin/env bash
set -euo pipefail
bunx commitlint --color <<< "$(head -n1 "$1")"
