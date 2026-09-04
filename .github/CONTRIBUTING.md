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

### Windows shell requirements

The repository's pnpm scripts use Bash. On Windows, install [Git for Windows](https://git-scm.com/download/win)
and run the development commands from Git Bash, where `bash` is available on `PATH`. If you run pnpm from
PowerShell instead, add the Git for Windows `bin` directory that contains `bash.exe` to `PATH` first.

The repository keeps formatter inputs on LF through `.gitattributes`. Git does not rewrite unchanged files
when an existing `core.autocrlf=true` checkout first pulls that rule. If `git ls-files --eol AGENTS.md`
still reports `w/crlf` and `pnpm lint` reports widespread formatting failures, first make sure
`git status --short` is empty, then run:

```sh
$ pnpm format
$ git add -u
$ git status --short
```

The format command rewrites the existing checkout to LF. Because the checkout was clean, `git add -u`
only refreshes equivalent tracked content after line-ending normalization. The final status command should
remain empty; inspect any reported changes instead of discarding them.

To set up the repository, run:

```sh
$ ./scripts/bootstrap
$ pnpm build
```

This will install all the required dependencies and build output files to `dist/`.

## Modifying/Adding code

Most of the SDK is generated code. Modifications to code will be persisted between generations, but may
result in merge conflicts between manual patches and changes from the generator. The generator will never
modify the contents of the `src/lib/` and `examples/` directories.

## Custom-code budget

The custom-code budget counts additions plus deletions in the remaining patch
against verified generated output. `.castiron-ratchet.json` defines this repository's
ceiling. CI uses the checker and budget on main, not the PR's proposed versions.

Budget changes must be in a separate PR modifying **only `.castiron-ratchet.json`**.
Justify the current usage, proposed ceiling, and why fixing generation is not
appropriate in the PR description. Increases require a **human approving review**
and must merge before an SDK change relies on them. Agents may draft proposals,
but must not approve increases or bypass the gate. Keep default CODEOWNERS.
Lower the ceiling after cleanup while retaining headroom; decreases must still
fit the measured usage.

See [custom-code technical details](../scripts/castiron/CUSTOM_CODE.md) for accounting,
local checks, trusted CI, and activation instructions.

## Security requirements

### Credentials, examples, and diagnostics

- Never commit API keys, npm tokens, private keys, `.env` files, customer content, or other live credentials.
  Read `OPENAI_API_KEY` from the environment and use synthetic values in examples, fixtures, mocks,
  recordings, and snapshots.
- Never include secret API keys in browser bundles. Enabling `dangerouslyAllowBrowser` requires explicit
  security review; examples must not suggest exposing server-side credentials to browsers.
- Always redact authentication headers, cookies, and webhook secrets. Keep real customer-sensitive request or
  response data out of default or uncontrolled logs, test output, snapshots, and CI artifacts. Preserve
  documented opt-in `OPENAI_LOG=debug` or `logLevel: 'debug'` logging, `APIError.error` diagnostics,
  and clearly fake or sanitized fixtures; warn that diagnostics may contain sensitive data and redact them
  before forwarding to untrusted sinks.

### Dependencies and release automation

- Review direct and transitive dependency updates, `pnpm-lock.yaml`, package provenance, and install or
  build lifecycle scripts, including dependencies used by examples and ecosystem fixtures.
- Use `pnpm install --frozen-lockfile` in CI and when verifying an unchanged lockfile. For intentional
  dependency updates, regenerate and review `pnpm-lock.yaml` with the corresponding dependency changes.
  Do not weaken `pnpm-workspace.yaml`
  safeguards such as `minimumReleaseAge`, `minimumReleaseAgeStrict`, `trustPolicy`, `blockExoticSubdeps`,
  `strictDepBuilds`, `trustLockfile`, or the `allowBuilds` allowlist without explicit security review.
- Pin third-party GitHub Actions to full, immutable commit SHAs and review action updates. Keep workflow
  permissions minimal; grant `id-token: write`, GitHub App access, and npm publishing privileges only to
  trusted jobs that require them.
- Publish npm packages only through protected GitHub Actions OIDC trusted publishing. Never expose GitHub
  App private keys, OIDC credentials, long-lived registry tokens, or other release secrets to untrusted code,
  unreviewed lifecycle scripts, logs, artifacts, or public package contents.

### Security-sensitive changes

Require focused review and relevant regression or security tests for changes affecting authentication,
API-key forwarding, custom `fetch`, `baseURL`, redirects, headers, browser credential handling, uploads or
filesystem paths, webhook signature verification, parsing or serialization, and release or publishing flows.
Exercise malformed or hostile input where relevant, including prototype-pollution and credential-leak cases.

Report suspected vulnerabilities privately through [`SECURITY.md`](SECURITY.md). Do not disclose
vulnerability details in public GitHub issues or pull requests.

## Adding and running examples

All files in the `examples/` directory are not modified by the generator and can be freely edited or added to.

```ts
// add an example to examples/<category>/<your-example>.ts

#!/usr/bin/env -S npm run tsn -- -T
…
```

```sh
$ chmod +x examples/<category>/<your-example>.ts
# run the example against your api
$ npm run tsn -- -T examples/<category>/<your-example>.ts
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

The mock server uses [the OpenAI Steady fork](https://github.com/openai-oss-forks/steady).
`scripts/steady/manifest.json` is the single source of dependency pins: the
Steady Git commit and source digest, plus the Deno version and runtime checksums. `./scripts/steady/install` fetches that source, verifies the runtime,
and caches dependencies using the fork's frozen Deno lockfile. It requires
Git, Node.js, curl, unzip, and sha256sum or shasum. The installation supports
macOS and Linux on x64/ARM64, and Windows x64 through Git Bash.

`./scripts/run-steady` verifies the local source and runtime, then runs without
downloading dependencies. Pass a local OpenAPI specification path. To update
Steady, review the fork commit and run
`node scripts/steady/update.cjs <full-commit-sha>`. This updates the manifest
with the commit and its source digest; no launcher or test edits are needed.
Then run `./scripts/steady/install`. Review the release checksums when changing Deno.
Run `node scripts/steady/test.cjs` to check the
installation, integrity checks, and mock-server lifecycle.

This checkout owns `scripts/steady/.cache`. Source and dependency entries are
keyed by the Steady revision; the runtime and dependencies also include the Deno
version, and runtimes include the platform. Install and launch commands remove
unselected entries after 30 idle days. A process lease protects entries until
the command exits, including running Windows executables. The current pins are
retained; changing the manifest makes the previous entries eligible for expiry.
Cleanup runs on the next install or launch, without background work.

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
starts a [Steady mock server](https://github.com/openai-oss-forks/steady) against the
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
by Git and uploaded as an artifact by the performance-benchmark job in normal CI.
The separate, manually triggered or scheduled benchmark workflow also uploads a
runtime, runner, revision, and fixture-hash metadata file. Pass a benchmark name
or file filter directly to run only part of the suite, for example:

```sh
$ pnpm bench streaming
```

Benchmarks cover request preparation, header merging, query serialization, SSE
chunk decoding and JSON parsing, incremental structured output parsing, schema
generation and validation, and base64-versus-float embedding responses. Each case
prepares its fixtures before timing and uses explicit warmup and repeated
measurements. Compare medians and tail latency only between runs with the same
Node.js version, CPU or runner class, SDK revision, fixture sizes, and background
load. Shared CI runners are useful for collecting trends but are too variable for
blocking performance thresholds.

## Linting and formatting

This repository uses [Ultracite](https://www.ultracite.ai/) with
[Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) and
[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) to format and lint its code.
The Ultracite presets live in `oxfmt.config.ts` and `oxlint.config.ts`, with
repository-specific formatting options, import rules, fixture exceptions, and
generated-file lint exclusions layered on top. Files with a Castiron-generated
header and explicitly listed legacy SDK files are formatted and checked only for
unused imports and restricted SDK package imports; other handwritten files in the
same directories remain checked. Existing handwritten patterns are explicitly
exempted from incompatible Ultracite rules, while the remaining preset rules stay
enabled.

Handwritten SDK exports, their public class members, configuration fields, and
event payload properties must have accurate JSDoc so that their behavior is
available through editor hover. Describe meaningful defaults, prerequisites,
failure modes, and lifecycle semantics rather than repeating TypeScript types.
Generated SDK files and vendored dependencies are excluded.

To check formatting and lint rules:

```sh
$ pnpm lint
```

To format and fix all lint issues automatically:

```sh
$ pnpm format
```

Install the recommended Oxc VS Code extension to enable the checked-in
format-on-save and lint-autofix editor settings.

## Publishing and releases

Changes made to this repository via the automated release PR pipeline publish to npm automatically. Publishing
requires GitHub Actions OIDC trusted publishing; local token-based publishing is not supported.

### CI coverage and release policy

The table describes workflow execution and npm publication dependencies for changes targeting `main`
in `openai/openai-node`.
Required merge checks are configured in repository rules. The `test matrix` check requires the Node.js
tests, benchmarks, and credential-free ecosystem job to succeed.

| Checks                                                              | PR             | Merge queue   | Push to `main`    | Release PR     | npm publication                             |
| ------------------------------------------------------------------- | -------------- | ------------- | ----------------- | -------------- | ------------------------------------------- |
| CI lint, build, Node.js tests, packed-package tests, benchmarks     | Runs¹          | Runs          | Runs              | Runs¹          | CI gate                                     |
| Credential-free ecosystem startup/import and compatibility checks   | Runs           | Runs          | Runs              | Runs           | CI gate                                     |
| Live examples and live ecosystem tests                              | Skipped        | Skipped       | Runs²             | Skipped        | CI gate²                                    |
| CodeQL merge protection, breaking-change detection, Castiron checks | Runs           | Runs          | Not triggered     | Runs           | Merge protection; no separate release gate  |
| Standalone Node.js support policy workflow                          | Not triggered  | Not triggered | Runs              | Not triggered  | No separate gate; assertions also run in CI |
| Release PR title/version validation                                 | Not applicable | Not triggered | Not applicable    | Runs           | Checked before release creation             |
| Release state, native-browser compatibility, release-package build  | Not applicable | Not triggered | Release workflow³ | Not applicable | Required                                    |

¹ Same-repository PRs run these checks through branch pushes; duplicate PR-event jobs may be skipped.
Fork PRs and `ready_for_review` events run them directly. Release PRs receive the same CI coverage.
² Live checks require credentials and skip main pushes triggered by `dependabot[bot]`.
³ Release state is checked on main pushes; browser compatibility and package build run when publication is due.

The **CI gate** in [`create-releases.yml`](workflows/create-releases.yml) requires a successful
[`ci.yml`](workflows/ci.yml) push run on `main` for the immutable release SHA, including live checks when
they run. Missing CI, a mismatched SHA, failure, cancellation, or timeout prevents publication; a green
run for another commit cannot satisfy the gate. The gate checks the overall workflow conclusion, so it
does not independently reject skipped jobs. Experimental Node.js results remain advisory as defined by
[the Node.js support policy](../NODE_VERSION_POLICY.md).

When adding or changing checks, especially main-only checks, explicitly choose whether they block
publication or are advisory. Update this table and the focused workflow regressions in
[`tests/release-publish-workflow.test.ts`](../tests/release-publish-workflow.test.ts) to preserve the
release SHA, failure handling, and publication dependencies. Keep merge-only workflows distinct from
the publication gate.

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

The [`Create releases` GitHub Actions workflow](https://github.com/openai/openai-node/actions/workflows/create-releases.yml)
publishes releases after changes land on `main`. If publication fails, rerun the failed workflow to retain the
protected `publish` environment, immutable release checkout, and npm OIDC trusted publishing.
