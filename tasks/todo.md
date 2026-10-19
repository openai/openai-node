# Node generated ownership transition tasks

Canonical analysis, inventory, contracts and execution policy: [plan.md](plan.md).
Every task below is split into small PRs where indicated. Work is preauthorized;
CI, required review and compiler-before-promotion rules remain required.

## Foundation

- [x] Verify current-main snapshot and all 47 mixed-file counts.
- [x] Map each mixed file to an owning workstream and compatibility constraints.
- [x] Merge reviewed transition plan: [#2985](https://github.com/openai/openai-node/pull/2985), merge `bd036b4c3d9ae78982ed0c632d54da6f9cd7f6d3`.
- [x] Post a deduplicated root #sdk-reviews request covering all three initial changes.
- [x] Use Conductor state updates for continuation; do not poll independently.
- [ ] For every subsequent PR/Delta, request review in root #sdk-reviews and record its receipt.

## First parallel compiler slices

- [ ] H1a: generate exact `Files.waitForProcessing` declaration/delegate.
      Acceptance: preserve destructured defaults, `id` name, method ownership and return
      type; reuse current handwritten implementation; no arbitrary code injection.
      Verify typed-fact validation, rendered-output regression and immutable parity.
      Depends on: no other implementation slice. Scope: compiler polling pipeline and
      source configuration; split config activation if compiler capability must land first.
- [ ] E1: generate the smallest missing compatibility barrel/alias via its owner.
      Acceptance: preserve all existing exports, namespaces and constructor identities;
      no source wrapper classes or extra runtime implementation.
      Verify compiler export projection plus SDK declaration/runtime comparisons.
      Depends on: existing export capability investigation; independent of H1a unless
      shared compiler facts require a prerequisite.
- [ ] Verify actual compiler merges, then generate compatible SDK previews.
- [ ] Promote and merge each SDK drawdown through normal Castiron flow; record exact
      snapshots/counts and run focused SDK tests plus affected compatibility checks.

## Remaining independent queues

- [ ] D0: remove duplicate Safety/Alerts reference block, retaining generated content
      and legacy fragment aliases. Acceptance: retain canonical Cases/Alerts, every
      helper entry, all unique link targets and old `#safety-1`/`#alerts-1` fragment
      URLs via explicit anchors; no SDK/API or policy changes.
      Verify pinned Markdown formatting, section/link comparisons and independent
      review. Expected reduction: 8 custom patch lines, unchanged mixed-file count.
      Depends on: merged plan only; independent of pending compiler approvals.
      Published ready as [#2987](https://github.com/openai/openai-node/pull/2987); root
      #sdk-reviews and native SDK team review requested on 2026-10-19.
      Completion requires normal review/CI and actual merge.
      The legacy fragment anchors remain custom until emitted by their owning
      reference generator; preserve them in later drawdown slices.

- [ ] H1b: vector-file create/poll/upload composition (33 baseline patch lines).
- [ ] H1c: vector-batch create/upload composition (34 baseline patch lines).
      Acceptance for both: exact existing public methods, defaults, options identity,
      overrides and cancellation; current algorithms remain handwritten.
      Verify generated-resource helpers, vector upload, polling/abort tests and packed
      entrypoints. Depends on reviewed helper binding design, then merged compiler.
- [ ] E2: remaining legacy registration/barrels and helper exports (132 lines total).
      Acceptance: preserve complete export graph and method/type owner; verify all
      affected source subpaths, CJS/ESM exports and namespace declarations.
      Depends on owning H2/P helpers where exports share those generated files.
- [ ] H2: Runs then Threads helper/type emission (92 + 369 lines).
      Acceptance: current stream/poll methods, overloads, aliases and dispatch preserved.
      Verify AssistantStream/poll regressions, declarations and generated API reference.
      Depends on reusable reviewed helper facts and merged compiler before promotion.
- [ ] P1: embeddings overload/delegate (29 lines).
- [ ] P2: Chat parsed types and helper bridges; schema fixes separately (218 lines).
- [ ] P3: Responses enriched types, create/retrieve enrichment and helper bridges;
      compatibility aliases/schema fixes separately (215 lines).
      Acceptance: unchanged inferred/explicit types, promise/stream behavior and object
      identity. Verify schema integration, parsers/streams, declarations and packed
      subpaths. Independent resources; serialize shared compiler projection edits.
- [ ] A: separate Agents union, runtime page, files, artifacts and sessions slices
      (five files, 147 lines). Acceptance: current exclusive union/runtime exports and
      helper behavior preserved. Verify Agents types, pagination, helpers, result
      collection and generated examples. Depends on each owning fact, then compiler merge.
- [ ] T: audio generic/overload emission and beta streaming-error shape
      (three files, 81 lines). Acceptance: no inference tightening or overload changes;
      preserve wire event optionality. Verify compile-time examples and public audio/
      streaming behavior. Stable event change coordinates with P3/W.
- [ ] R: separate null-filter, admin-auth, image metadata and Skills filename slices
      (five files, 40 lines). Acceptance: existing request bytes, precedence and key
      selection preserved. For `images.edit`, normalize explicit null safety identifiers
      in the effective body after `options.body` overrides so multipart omits the
      field; preserve non-null/empty strings, other values/fields and caller objects.
      Retain `tests/lib/image-safety-identifier.test.ts` across streaming/non-streaming
      and eager/lazy uploads, including override precedence and body-read behavior.
      Preserve JSON image-generation behavior. Verify actual public request boundary
      and security regressions.
      Prefer source schema/configuration when already supported; no new guessed lists.
- [ ] S: webhook async verification interface generation (77 lines).
      Acceptance: exact current signature/defaults/errors/security behavior. Verify
      webhook regressions and crypto/runtime entrypoints; maintainer/security review.
- [ ] D: generate valid Agents request examples/tests, provider type assertion and
      all helper reference entries (four files, 36 lines). Acceptance: keep meaningful
      assertions and canonical doc entries. Verify generated tests, tsc and links.
      Depends on owning features; do not reclassify tests merely to remove accounting.

## High-risk staged queues

- [ ] W1: stable/beta Responses adapters; W2: Live/forks/sideband adapters
      (12 files, 340 lines). Acceptance: shipped hooks, credentials, events and lifecycle
      behavior unchanged; no duplicate transports. Verify full WebSocket contract,
      retries/abort/headers/cleanup, large payloads and optional dependency boundaries.
      Reconcile overlapping open realtime work first; serialize shared transport changes.
- [ ] C1: client options/callable credentials; C2: provider construction/cloning;
      C3: workload identity/X.509; C4: request lifetime and transport integration
      (one mixed file, 889 lines total). Acceptance: one current client class, same
      extension points and identities, isolated auth/provider state. Verify exact
      declaration baseline, providers/legacy clients and complete request lifetimes.
      Each slice needs focused maintainer/security review and merged compiler before SDK.

## Final checkpoint

- [ ] Verified inventory reaches zero files and zero patch lines without exclusions,
      checkpoint edits or checker changes; handwritten code growth assessed separately.
- [ ] Full trusted manifest comparison passes for every generated-owned file,
      including workflows/actions, file bytes and Git modes, exact manifest and
      retired paths. Record verifier/candidate/checkpoint revisions and zero
      violations. This is mandatory even if schema-v2 activation is deferred;
      a policy-gated schema-v1 no-op is not a pass. Missing manifest/verifier support
      blocks completion until normal upstream generation supplies it.
- [ ] Public contracts, packed CJS/ESM, exact runtime floor, supported Node lines,
      TypeScript floor, optional integrations and relevant ecosystems verified.
- [ ] All compiler prerequisites and SDK promotions actually merged.
- [ ] Propose isolated budget-only reduction/strict-ownership activation after zero
      is verified. Do not combine with SDK implementation; retain normal ownership/reviews.
- [ ] Update plan evidence and retire continuation once completion is verified.
