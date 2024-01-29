#!/usr/bin/env bash

# Check if readme is updated according to the various action.yml metadata, exit with 1 if not.

script_dir="$(dirname "${BASH_SOURCE[0]}")"
cd "$script_dir/.." || exit

diff <(python3 generate-docs.py README.md) README.md || {
  cat <<EOF
The documentation is not up-to-date. Run the following command to update:
printf "%s\n" "\$(python generate-docs.py README.md)" > README.md
EOF
  exit 1
}
