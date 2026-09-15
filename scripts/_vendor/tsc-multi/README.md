# tsc-multi

Vendored from version 1.1.11 of
https://github.com/stainless-api/tsc-multi/tree/176d47e23d437d66552cb8756feb05d140515fc7.

The previous dependency used the release tarball at
https://github.com/stainless-api/tsc-multi/releases/download/v1.1.11/tsc-multi.tgz.
That tarball has SHA-256
`1e6a40dda40ff5066fb3b348d1fb354e21ed68b2afd6e67a7d8ce59418c98af2`.

The `src/helpers.ts` file is generated upstream by `scripts/tslib.cjs` and was
reconstructed from the matching release tarball.

SDK maintainers own this vendored build tool. Updates must review the upstream
commit, verify and record the release tarball's SHA-256, refresh generated
helpers, preserve the upstream [`LICENSE`](LICENSE), and run `pnpm build`.
