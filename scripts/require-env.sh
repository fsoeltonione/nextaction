#!/usr/bin/env bash
# Loud required-environment validation for CircleCI release jobs.
#
# The previous validation used a chain of `test -n "${VAR}"`. When a required
# context variable was absent the step exited 1 with NO output at all, so the
# only thing a reader saw was "Exited with code exit status 1" and there was no
# way to tell which variable (or which context) was missing.
#
# This helper reports every missing variable by name and exits non-zero, so the
# failure explains itself.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: require-env.sh NAME [NAME ...]" >&2
  exit 2
fi

missing=""
for name in "$@"; do
  if [ -z "${!name:-}" ]; then
    missing="${missing} ${name}"
  fi
done

if [ -n "${missing}" ]; then
  echo "Missing required environment variables:${missing}" >&2
  echo "Configure them in the CircleCI context(s) attached to this job." >&2
  exit 2
fi