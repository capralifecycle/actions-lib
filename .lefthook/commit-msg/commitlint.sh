#!/usr/bin/env bash
npx commitlint --color <<< "$(head -n1 "$1")"
