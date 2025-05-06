#!/usr/bin/env bash
set -euo pipefail
npx commitlint --color <<< "$(head -n1 "$1")"
