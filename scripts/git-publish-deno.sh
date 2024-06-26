#!/usr/bin/env bash

set -exuo pipefail

cd "$(dirname "$0")/.."

# This script pushes the contents of the `deno` directory to the `deno` branch,
# and creates a `vx.x.x-deno` tag, so that Deno users can
# import OpenAI from "https://raw.githubusercontent.com/openai/openai-node/vx.x.x-deno/mod.ts"

# It's also possible to publish to deno.land.  You can do this by:
# - Creating a separate GitHub repo
# - Add the deno.land webhook to the repo as described at https://deno.com/add_module
# - Set the following environment variables when running this script:
#   - DENO_PUSH_REMOTE_URL - the remote url of the separate GitHub repo
#   - DENO_PUSH_BRANCH - the branch you want to push to in that repo (probably `main`)
#   - DENO_MAIN_BRANCH - the branch you want as the main branch in that repo (probably `main`, sometimes `master`)
#   - DENO_PUSH_VERSION - defaults to version in package.json
#   - DENO_PUSH_RELEASE_TAG - defaults to v$DENO_PUSH_VERSION-deno

die () {
  echo >&2 "$@"
  exit 1
}

# Allow caller to set the following environment variables, but provide defaults
# if unset
# : "${FOO:=bar}" sets FOO=bar unless it's set and non-empty
# https://stackoverflow.com/questions/307503/whats-a-concise-way-to-check-that-environment-variables-are-set-in-a-unix-shell
# https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html

: "${DENO_PUSH_VERSION:=$(node -p 'require("./package.json").version')}"
: "${DENO_PUSH_BRANCH:=deno}"
: "${DENO_MAIN_BRANCH:=main}"
: "${DENO_PUSH_REMOTE_URL:=$(git remote get-url origin)}"
: "${DENO_GIT_USER_NAME:="Stainless Bot"}"
: "${DENO_GIT_USER_EMAIL:="bot@stainlessapi.com"}"
if [[ $DENO_PUSH_BRANCH = "deno" ]]; then
  : "${DENO_PUSH_RELEASE_TAG:="v$DENO_PUSH_VERSION-deno"}"
else
  : "${DENO_PUSH_RELEASE_TAG:="v$DENO_PUSH_VERSION"}"
fi

if [ ! -e deno ]; then ./scripts/build; fi

# We want to commit and push a branch where everything inside the deno
# directory is at root level in the branch.

# We can do this by temporarily creating a git repository inside deno,
# committing files to the branch, and pushing it to the remote.

cd deno
rm -rf .git
git init -b "$DENO_MAIN_BRANCH"
git remote add origin "$DENO_PUSH_REMOTE_URL"
if git fetch origin "$DENO_PUSH_RELEASE_TAG"; then
  die "Tag $DENO_PUSH_RELEASE_TAG already exists"
fi
if git fetch origin "$DENO_PUSH_BRANCH"; then
  # the branch already exists on the remote; "check out" the branch without
  # changing files in the working directory
  git branch "$DENO_PUSH_BRANCH" -t origin/"$DENO_PUSH_BRANCH"
  git symbolic-ref HEAD refs/heads/"$DENO_PUSH_BRANCH"
  git reset
else
  # the branch doesn't exist on the remote yet
  git checkout -b "$DENO_PUSH_BRANCH"
fi

git config user.email "$DENO_GIT_USER_EMAIL"
git config user.name "$DENO_GIT_USER_NAME"

git add .
git commit -m "chore(deno): release $DENO_PUSH_VERSION"
git tag -a "$DENO_PUSH_RELEASE_TAG" -m "release $DENO_PUSH_VERSION"
git push --tags --set-upstream origin "$DENO_PUSH_BRANCH"
rm -rf .git
