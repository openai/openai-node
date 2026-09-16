#!/usr/bin/env bash
# Keep installed packages and the staging names used by npm, pnpm, and Yarn Classic.
# A tmp or .tmp parent alone does not identify a disposable Git-install checkout.
parent="${PWD%/*}"
case "${parent##*/}/${PWD##*/}" in
  node_modules/* | tmp/git-clone* | tmp/_tmp_* | .tmp/*.prepare)
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
