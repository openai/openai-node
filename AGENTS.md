# Repository Guidance

<a id="generated-file-ownership"></a>

## Generated SDK

Before editing SDK files, read [Modifying/Adding code](.github/CONTRIBUTING.md#modifyingadding-code) to identify schema, generator, or handwritten ownership. Keep handwritten policy, automation, tests, and examples small; change exported APIs only when explicitly required.

## Start with the actual problem

- For observable behavior fixes, reproduce through the current public SDK entrypoint first. Check existing issues/PRs; inspect schema/upstream ownership when relevant. Do not duplicate work, change intended API behavior, or patch generated symptoms owned upstream.
- Add a regression failing before and passing after the fix: compile-time for type errors; actual stream, transport, or packaging boundaries for those bugs, not merely internal mocks.
- For non-behavioral docs, dependencies, generated output, formatting, workflows, or policy, use minimal artifact-appropriate validation: links/rendering, configuration, installation, or builds.

## Keep changes small and coherent

- Solve the narrow requirement; avoid unrelated refactors, formatting, dependency/lockfile churn, generated edits, speculative abstractions/shims, and unrequested capabilities.
- Establish invariants at their owning boundary. Reuse parsers, registries, helpers, and compiler/runtime facilities. Recurring edge cases call for revisiting ownership, not accumulating special cases.
- Separate incomplete API/SSE wire shapes from enriched public types. Populate required snapshot fields before exposure or type their temporary absence honestly; normalize at the owning boundary. Prefer TypeScript narrowing/inference over `any`, assertions, suppressions, or casts hiding unproven contracts.
- Keep handwritten production/tests cohesive. Extract an owner only when the change materially grows a file and reveals a distinct responsibility; do not inflate fixtures/suites to justify complexity.
- Avoid handwritten model/endpoint/capability/schema lists unless required by contract; prefer documented schema/API and server validation.

## Preserve SDK contracts and compatibility

- Compare with the base revision across exports/import subpaths, provider/legacy clients, stable/beta APIs, and equivalent streaming/non-streaming paths. Without explicit breaking-change authorization, preserve declarations, overloads, optional fields, discriminators, object identity, protected hooks, option/header precedence, cloning, and documented defaults.
- Preserve meaningful `0`, `false`, and `""`; distinguish `null` from omission/`undefined` where required. Do not replace presence/nullish checks with truthiness.
- Schema helpers: check Zod v3/v4, Standard Schema, inferred outputs, escaped JSON Pointers, and actual serialized schemas.
- Verify affected CJS/ESM entrypoints, exact minimum Node version, policy-defined Node lines, supported TypeScript versions, and relevant browser/worker/Bun/Deno/bundler/serverless integrations. Newest-CI success does not establish minimum-version compatibility.
- Isolate optional integrations' dependencies, environments, credentials, and runtime requirements from unrelated clients. Changed import boundaries need installed-and-absent dependency tests.
- Public-contract changes require affected canonical docs, executable examples, or meaningful public JSDoc. Preserve documentation URLs/import paths; examples must run with documented environments/dependencies.

## Security and lifecycle correctness

Read and apply [contributor security requirements](.github/CONTRIBUTING.md#security-requirements) for credentials/synthetic fixtures, browser review, redaction and opt-in diagnostics, dependencies, action pins, OIDC-only publishing, and sensitive-change review/testing. Report vulnerabilities privately through [.github/SECURITY.md](.github/SECURITY.md), never public issues/PRs.

- Always redact credentials. Keep customer-sensitive payloads out of uncontrolled errors as well as logs/artifacts; preserve documented debug logging and `APIError.error` with warnings and redaction before untrusted sinks.
- Treat endpoints, headers, filenames, schemas, and object properties as untrusted. At JSON-record boundaries, validate emitted own properties/values, including serialization hooks and omissions; reject or safely preserve dangerous prototype keys. Preserve supported inherited protocols. Validate final requests across normalized host/origin, redirects, hooks, custom fetch, and current/legacy entrypoints; never leak tokens, keys, certificates, bodies, or credentials across trust boundaries.
- Validation/dispatch must use the same security-critical values or serialized snapshot, bounded in memory and captured before irreversible network/body side effects. Preserve options-object identity and protected-hook mutations.
- Minimize workflow token/permission/secret scope. Bind privileged checkout/release/publication to validated immutable commits; floating refs, mutable tags, optional checks, and assumed settings/app permissions are insufficient. No token-based release paths.
- Exercise affected streaming/upload/auth/retry/timeout/cancellation lifetimes: headers; JSON/error/binary/SSE bodies; raw responses/async iterators; redirects/abort reasons; retry budgets/concurrent refresh; cleanup and reader/listener/lock ownership. Avoid new retained state and accidental quadratic hot paths.
- Large JSON bodies, events, and WebSocket messages are legitimate API payloads, not inherently hostile. No arbitrary body/frame/event/line limits: prefer incremental processing, amortized-linear buffering, cleanup, and cancellation. Rejection limits require an explicit owner-approved API contract and review of supported payloads/transports. Test large synthetic in-memory payloads deterministically through public entrypoints, without large captures or slow live image generation.
- Caches need an owner, complete identity key, lifetime, and invalidation policy. Do not trust mutable caller snapshots, conflate transport/certificate identities, or leak request/client state or credentials across clients, transports, retries, or auth contexts.
- Dependency changes also require focused security review and relevant regressions.

## Tooling, dependencies, and verification

- Follow [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md), `.nvmrc`, and pinned `package.json` tools. Keep `./scripts/test`, `./scripts/lint`, and `./scripts/format` canonical; package aliases/CI route through them, preserving generated and handwritten coverage.
- Dependency changes: limit updates to the requested package/closure; check frozen-lockfile installation, module format, runtime/TypeScript floors, release-age/trust policy, and audited lifecycle-build permissions. No unrelated transitive upgrades.
- Changed files must pass pinned formatting/linting. Do not disguise code or weaken fixtures to evade rules. Public-type, compatibility, or regression conflicts permit only the narrowest documented exception.
- Run focused regressions first, then applicable `pnpm lint`, `pnpm exec tsc`, `pnpm build`, and `./scripts/test`. Changed boundaries require relevant generated tests, packed-package/export checks, runtime versions, ecosystem tests, benchmarks, or workflow checks. Report actual results, infrastructure failures, and unrun checks separately.

## Node.js version policy

Read [NODE_VERSION_POLICY.md](NODE_VERSION_POLICY.md): sole authority for lifecycle, deprecation, exceptions, and releases. `package.json#engines.node`, `.nvmrc`, and README are projections; CI derives its matrix from policy. Keep changes focused and consumer floors separate from tooling requirements. After projection changes, run:

```sh
node --experimental-strip-types scripts/check-node-version-policy.ts
```
