# Repository Guidance

## Generated SDK

Most SDK source is generated from the OpenAI API schema. Follow `.github/CONTRIBUTING.md` before
changing generated files. Handwritten policy, automation, tests, and examples
should remain small and should not alter exported SDK APIs unless the change
explicitly requires it.

## Start with the actual problem

- For externally observable bug or behavior fixes, reproduce the reported issue
  against the current repository and public SDK entrypoint before proposing a fix.
  Check existing issues and pull requests; inspect the API schema and
  generated/upstream ownership only when relevant. Do not duplicate existing work,
  "fix" intended API behavior, or patch a generated symptom that belongs in the
  schema or generator.
- For those behavior fixes, include a focused regression that fails before the change
  and passes afterward. Type errors need a compile-time reproduction; stream, transport,
  and packaging bugs need coverage at the actual affected boundary, not merely a
  passing internal mock.
- For docs-only, dependency-only, generated, formatting, workflow, or policy changes
  without an observable bug, use the smallest artifact-appropriate validation, such
  as link, render, configuration, installation, or build checks.

## Keep changes small and coherent

- Solve the narrow problem with the simplest implementation. Avoid unrelated
  refactors, reformatting, dependency or lockfile churn, generated-file edits,
  speculative abstractions, compatibility shims, and capabilities not requested.
- Establish an invariant once at its owning boundary instead of compensating in
  every caller. Reuse existing parsers, registries, helpers, and compiler/runtime
  facilities instead of creating parallel infrastructure or a hand-written parser.
  If successive edge cases keep appearing, reconsider the invariant and ownership
  rather than adding another special case.
- Model incomplete API/SSE wire shapes separately from enriched public SDK types.
  Keep required public snapshot fields accurate before exposing them, or type
  fields unavailable until later truthfully. Normalize incomplete items at their
  owning boundary instead of patching downstream consumers. Prefer TypeScript
  narrowing and inference over broad `any`, assertions, `@ts-ignore`, or casts
  that disguise an unproven contract.
- Keep handwritten production and test files cohesive. Extract a well-defined owner
  only when the current change materially grows a file and reveals a coherent,
  distinct responsibility. Keep unrelated cleanup separate, and do not inflate
  fixtures or suites to justify an overly complicated implementation.
- Avoid hand-maintained model, endpoint, capability, or schema lists unless the
  contract requires them. Prefer the documented API/schema and server-side
  validation over brittle client-side guesses.

## Preserve SDK contracts and compatibility

- Compare behavior with the base revision across existing public exports and import
  subpaths, provider and legacy clients, stable and beta surfaces, and equivalent
  streaming/non-streaming paths. Preserve published TypeScript declarations,
  overloads, optional fields, discriminators, object identity, protected hooks,
  request-option/header precedence, client cloning, and documented defaults unless
  the task explicitly authorizes a breaking change.
- Preserve meaningful `0`, `false`, and empty-string values, and distinguish
  explicit `null` from an omitted or `undefined` value where the contract does.
  Do not replace presence or nullish checks with truthiness checks.
- For schema helpers, check supported Zod v3/v4 and Standard Schema integrations,
  inferred output types, escaped JSON Pointer references, and the actual serialized
  schema rather than trusting an idealized intermediate TypeScript shape.
- Verify affected CJS/ESM entrypoints, the exact minimum supported Node version,
  affected policy-defined Node lines, supported TypeScript versions, and relevant
  browser, worker, Bun, Deno, bundler, or serverless integrations. The newest CI
  version passing does not prove compatibility with the minimum supported version.
- Keep optional integrations isolated from the core SDK. Do not make a provider's
  optional dependency, environment, credential, or runtime requirement mandatory
  for unrelated clients; test both installed and absent optional dependencies when
  the import boundary changes.
- Update affected canonical docs, executable examples, or meaningful public JSDoc
  when the public contract changes. Preserve existing documentation URLs and import
  paths, and make examples runnable with the documented environment and dependencies.

## Custom-code budget

Follow [the custom-code guidance](scripts/castiron/CUSTOM_CODE.md). Budget changes
belong in a separate PR containing only `.castiron-ratchet.json`, with an explicit justification
in the PR description. Increases require a **human approving review** before merging.
Agents may investigate and draft proposals, but must not approve budget increases
(including through a human's credentials) or bypass the gate. Do not weaken
counting, broaden exclusions, or alter generation metadata to make a change pass.
The checker and effective budget come from main, not the PR. Keep default CODEOWNERS.

## Security and lifecycle correctness

- Never commit API keys, tokens, private keys, `.env` files, customer data, or other
  secrets. Read `OPENAI_API_KEY` from the environment and keep examples, fixtures,
  recordings, and snapshots synthetic.
- Never place secret API keys in browser bundles or enable `dangerouslyAllowBrowser`
  without explicit security review. Always redact credentials, authorization
  headers, cookies, and webhook secrets. Keep real customer-sensitive request or
  response data out of default or uncontrolled logs, errors, test output,
  snapshots, and CI artifacts. Preserve documented opt-in `OPENAI_LOG=debug`
  or `logLevel: 'debug'` logging and `APIError.error` diagnostics with clear
  sensitive-data warnings; redact them before forwarding to untrusted sinks.
- Treat provider endpoints, headers, filenames, schemas, and object properties as
  untrusted. At JSON object-record boundaries, validate the own properties and
  values actually emitted, accounting for serialization hooks and omitted values;
  reject or safely preserve dangerous prototype keys. Preserve supported inherited
  protocols and validate the final request, including normalized host/origin,
  redirects, protected hooks, custom fetch transports, and both current and legacy
  entrypoints. Never leak bearer tokens, API keys, certificates, request bodies,
  or other credentials across trust boundaries.
- When validation and dispatch must agree, snapshot only the security-critical
  values or serialized representation, within bounded memory, before irreversible
  network or request-body side effects. Preserve request-options object identity
  and protected-hook mutations; never validate one mutable representation and
  serialize another.
- Keep workflow tokens, permissions, and secrets at the narrowest required scope.
  Bind privileged checkout, release, and publication operations to the validated,
  immutable commit; do not trust floating refs, mutable tags, optional checks, or
  assumptions about repository settings and app permissions.
- Pin third-party GitHub Actions to full, immutable commit SHAs. Publish npm packages
  only through protected GitHub Actions OIDC trusted publishing; never add token-based
  release paths. Expose GitHub App private keys, OIDC credentials, and permissions only to
  trusted release jobs; never expose them to unreviewed scripts or untrusted code.
- For streaming, uploads, authentication, retries, timeouts, and cancellation,
  exercise the complete request/response lifetime: headers, JSON/error/binary/SSE
  bodies, raw responses, async iterators, redirect handling, abort reasons, retry
  budgets, concurrent refresh, cleanup, and reader/listener/lock ownership as
  applicable. Avoid new retained state and accidental quadratic hot paths.
- Treat large payloads as a normal API contract, not evidence of malformed or
  hostile input. Responses, Chat Completions, and other APIs can legitimately
  return large `application/json` bodies, streaming events, and WebSocket
  messages. Do not introduce arbitrary fixed limits on bodies, frames, events,
  or lines as a security or efficiency fix. Prefer incremental processing,
  amortized-linear buffering, timely cleanup, and caller cancellation. Any new
  rejection limit needs an explicit, owner-approved API contract and a review
  of existing supported payloads and transports. Protect this behavior with
  deterministic public-entrypoint tests that construct large synthetic payloads
  in memory; do not commit large captures or require slow live image generation.
- Give every cache an explicit owner, complete identity key, lifetime, and
  invalidation policy. Do not trust caller-mutable snapshots, conflate changed
  transport/certificate identities, or leak request/client-specific state or
  credentials across clients, transports, retries, or authentication contexts.
- Require focused security review and relevant regression tests for authentication,
  network destinations or headers, browser credentials, files and uploads, webhook
  signatures, parsing, serialization, dependencies, and release automation. Report
  suspected vulnerabilities privately via `.github/SECURITY.md`; never disclose
  them in public issues or pull requests.

## Tooling, dependencies, and verification

- Follow `.github/CONTRIBUTING.md` and the tool versions pinned by `.nvmrc` and
  `package.json`. Keep `./scripts/test`, `./scripts/lint`, and `./scripts/format`
  as the canonical script entrypoints, with package-manager aliases and CI routing
  through them; preserve both generated and handwritten suite coverage.
- For dependency changes, update only the requested package and its dependency
  closure. Check `pnpm install --frozen-lockfile`, module format, supported runtime
  and TypeScript floors, minimum-release-age/trust policy, and audited lifecycle
  build permissions; do not hide unrelated transitive upgrades in the lockfile.
- Make changed files pass the actual pinned formatter and linter. Do not disguise
  code or weaken a fixture to evade a lint rule. When an intentional public type,
  compatibility requirement, or regression fixture genuinely conflicts with a
  rule, use the narrowest documented exception; avoid unnecessary suppressions.
- Run the focused regression first, then the checks appropriate to the change:
  `pnpm lint`, `pnpm exec tsc`, `pnpm build`, and `./scripts/test`. Exercise
  generated tests, packed-package/export checks, supported runtime versions,
  ecosystem integrations, benchmarks, or workflows when their boundaries change.
  Report exactly what ran and distinguish verified results from infrastructure
  failures or checks that could not be run.

## Node.js version policy

`NODE_VERSION_POLICY.md` is the sole authority for lifecycle, deprecation,
exception, and release rules. Read and apply it rather than copying its rules
into agent instructions. `package.json#engines.node`, `.nvmrc`, and the README
are enforcement projections; CI derives its runtime matrix from the policy.

Keep Node.js policy changes focused and keep the consumer runtime floor
separate from repository tooling requirements. After changing a policy
projection, run:

```sh
node --experimental-strip-types scripts/check-node-version-policy.ts
```
