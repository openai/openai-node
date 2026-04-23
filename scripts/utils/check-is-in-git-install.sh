#!/usr/bin/env bash
# Check if you happen to call prepare for a repository that's already in node_modules.
[ "$(basename "$(dirname "$PWD")")" = 'node_modules' ] ||
# The name of the containing directory that 'npm` uses, which looks like
# $HOME/.npm/_cacache/git-cloneXXXXXX
[ "$(basename "$(dirname "$PWD")")" = 'tmp' ] ||
# The name of the containing directory that `pnpm` uses, which looks like
# $HOME/.local/share/pnpm/store/v10/tmp/XXXXX
[ "$(basename "$(dirname "$PWD")")" = '.tmp' ]
