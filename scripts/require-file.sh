#!/usr/bin/env bash
# Loud required-file validation for release jobs.
#
# A `test -s <file>` whose file is missing or empty exits 1 with no output.
# This helper names the missing file instead.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: require-file.sh PATH [PATH ...]" >&2
  exit 2
fi

missing=""
for path in "$@"; do
  if [ ! -s "${path}" ]; then
    missing="${missing} ${path}"
  fi
done

if [ -n "${missing}" ]; then
  echo "Missing or empty required file(s):${missing}" >&2
  exit 2
fi