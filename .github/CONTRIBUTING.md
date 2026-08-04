## Setting up the environment

This repository uses the [`pnpm`](https://pnpm.io/installation) version pinned by `package.json`.
Other package managers may work but are not officially supported for development.
Use the Node.js version in `.nvmrc` for repository tooling. Install that version
with the official [Node.js installer](https://nodejs.org/en/download), or use
[`nvm`](https://github.com/nvm-sh/nvm):

```sh
$ nvm install
$ nvm use
```

The published package supports the Node.js LTS lines documented in
[`NODE_VERSION_POLICY.md`](../NODE_VERSION_POLICY.md); the repository toolchain may
be newer than the consumer runtime floor.
Do not rely on Corepack being available; install pnpm explicitly if needed:

```sh
$ PNPM_VERSION=$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")
$ npm install --global "pnpm@$PNPM_VERSION"
```

To set up the repository, run:

```sh
$ pnpm install
$ pnpm build
```

This will install all the required dependencies and build output files to `dist/`.

## Modifying/Adding code

Most of the SDK is generated code. Modifications to code will be persisted between generations, but may
result in merge conflicts between manual patches and changes from the generator. The generator will never
modify the contents of the `src/lib/` and `examples/` directories.

## Adding and running examples

All files in the `examples/` directory are not modified by the generator and can be freely edited or added to.

```ts
// add an example to examples/<your-example>.ts

#!/usr/bin/env -S npm run tsn -- -T
…
```

```sh
$ chmod +x examples/<your-example>.ts
# run the example against your api
$ npm run tsn -- -T examples/<your-example>.ts
```

## Using the repository from source

If you’d like to use the repository from source, you can either install from git or link to a cloned repository:

To install via git:

```sh
$ npm install git+ssh://git@github.com:openai/openai-node.git
```

Alternatively, to link a local copy of the repo:

```sh
# Clone
$ git clone https://www.github.com/openai/openai-node
$ cd openai-node

# With pnpm
$ pnpm link --global
$ cd ../my-package
$ pnpm link --global openai
```

## Running tests

The test suite is split between handwritten unit tests, which run with Vitest,
and generated API-resource tests, which remain on Jest. Generated tests have a
generator comment at the top of the file and primarily
live in `tests/api-resources/`; a few generated client tests also live directly
under `tests/`. Handwritten tests live in `tests/lib/`, `tests/helpers/`,
`tests/auth/`, and the remaining unmarked test files. The existing Jest-based
live and ecosystem fixtures also retain their own runners.

```sh
$ ./scripts/test       # Complete regular test suite; canonical repository entrypoint
$ pnpm test            # Package-manager alias for the complete regular suite
$ pnpm test:unit       # Handwritten, isolated SDK behavior; no mock server
$ pnpm test:generated  # Generated API-resource and client tests
```

Pass a handwritten or generated test path to the full-suite command to run only
its corresponding runner, for example `./scripts/test tests/lib/parser.test.ts`
or `./scripts/test tests/api-resources/models.test.ts`.

The generated portion of the full and generated suites automatically
starts a [Steady mock server](https://github.com/dgellow/steady) against the
OpenAPI spec when one is not already running. To manage that server yourself,
run `./scripts/mock` in a separate terminal.

## Running performance benchmarks

The Vitest benchmark suite measures SDK work locally using deterministic fixtures,
in-memory fetch responses, and synthetic streams. It does not require an OpenAI
API key or the mock server used by the regular test suite.

Use the Node.js version from `.nvmrc`, install repository dependencies, and run:

```sh
$ pnpm bench
```

To save the machine-readable Vitest benchmark report:

```sh
$ pnpm bench:json
```

This writes `benchmark-results.json` in the repository root. The report is ignored
by Git and is uploaded by the separate, manually triggered or scheduled benchmark
workflow alongside a runtime, runner, revision, and fixture-hash metadata file.
Pass a benchmark name or file filter directly to run only part of the suite, for
example:

```sh
$ pnpm bench streaming
```

Benchmarks cover SSE chunk decoding and JSON parsing, incremental structured
output parsing, schema generation and validation, and base64-versus-float
embedding responses. Each case prepares its fixtures before timing and uses
explicit warmup and repeated measurements. Compare medians and tail latency only
between runs with the same Node.js version, CPU or runner class, SDK revision,
fixture sizes, and background load. Shared CI runners are useful for collecting
trends but are too variable for blocking performance thresholds.

## Linting and formatting

This repository uses [Ultracite](https://www.ultracite.ai/) with
[Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) and
[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) to format and lint its code.
The Ultracite presets live in `oxfmt.config.ts` and `oxlint.config.ts`, with
repository-specific formatting options, import rules, fixture exceptions, and
generated-file exclusions layered on top. Files with the Stainless-generated
header are excluded from both formatting and linting; handwritten files in the
same directories remain checked. Existing handwritten patterns are explicitly
exempted from incompatible Ultracite rules, while the remaining preset rules stay
enabled.

To check formatting and lint rules:

```sh
$ pnpm lint
```

To run the separate Oxlint regression suite:

```sh
$ pnpm test:lint-regressions
```

To format and fix all lint issues automatically:

```sh
$ pnpm format
```

Install the recommended Oxc VS Code extension to enable the checked-in
format-on-save and lint-autofix editor settings.

## Publishing and releases

Changes made to this repository via the automated release PR pipeline should publish to npm automatically. If
the changes aren't made through the automated pipeline, you may want to make releases manually.

### Override an automated release version

Do not edit an automated release PR title to change its version. The title must match the version generated in
`package.json`, and CI rejects mismatches so that the package, changelog, tag, and release stay consistent.

To select a different version, merge a conventional commit with a `Release-As: <version>` footer into `main`.
For example:

```text
chore: set the next release version

Release-As: 7.4.0
```

Release Please will then regenerate the release PR files and title with that version.

### Publish with a GitHub workflow

You can release to package managers by using [the `Publish NPM` GitHub action](https://www.github.com/openai/openai-node/actions/workflows/publish-npm.yml). This requires a setup organization or repository secret to be set up.

### Publish manually

If you need to manually release a package, you can run the `bin/publish-npm` script with an `NPM_TOKEN` set on
the environment.
