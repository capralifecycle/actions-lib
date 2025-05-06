#!/usr/bin/env bash
set -euo pipefail

script_dir="$(dirname "${BASH_SOURCE[0]}")"
cd "$script_dir/.." || exit

updated_readme=$(uv run generate-docs.py README.md)

if [ "$updated_readme" = "" ]; then
  echo "Updated README is empty, will not overwrite."
  exit 1
fi

echo "$updated_readme" > README.md
git diff README.md
