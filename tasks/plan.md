# Eliminate mixed generated and handwritten files in the Node SDK

## Objective and non-negotiable contract

Every Castiron-owned file should match its verified generated snapshot. SDK-specific
algorithms belong in cohesive handwritten modules; the compiler must emit their
public declarations, imports, delegation, and exports. A file is not clean merely
because its custom implementation was moved elsewhere: its remaining bridge must
also be generated.

**This transition must introduce zero developer-facing breaking changes.** Preserve
the shipped SDK contract, including behavior that differs from today's generator.
Do not remove APIs, change defaults, tighten accepted types, reorder overloads,
rename nested types, change constructor identity, alter request precedence, raise
runtime floors, or require optional dependencies. Do not restore generated content
blindly. Compatibility fixes that change behavior need separate authorization and
must not be bundled into this migration.

The work is authorized to proceed through small ready-for-review PRs and compiler
changes without further routine confirmation. Normal required human reviews,
compiler-before-promotion ordering, security review, and merge protections remain
in force. Budget increases, accounting changes, exclusion changes that merely hide
patches, and manually edited generation metadata are not part of this plan.

## Verified baseline: 2026-10-19

The audit uses current public main, SDK **7.39.0**, rather than the older local
checkout. The local checkout's existing lockfile modification is unrelated.

| Evidence                           | Value                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Integrated SDK revision            | `c3e69cdabaa5a03be6f3c5ae89449aa2c950dd75`                         |
| Verified public generated snapshot | `4f35fe8c63cb8d9deb93cd3ac6055e601efc8076`                         |
| Generation ID                      | `1ec90ff0-46f6-46e7-9b41-e4d26f449d4a`                             |
| Verified content hash              | `508e64dd6f387285e9f3ebfe1e60057f7d5c216f10fbd378ccd4c0628f69417c` |
| Mixed files                        | **47**                                                             |
| Mixed source files                 | **43**                                                             |
| Mixed test files                   | **3**                                                              |
| Mixed documentation files          | **1** (`api.md`)                                                   |
| Added custom-patch lines           | **2,299**                                                          |
| Deleted generated lines            | **444**                                                            |
| Total custom patch                 | **2,743 lines**                                                    |
| Source-only custom patch           | **2,707 lines**                                                    |
| Physical lines in all mixed files  | **66,996**                                                         |
| Current budget ceiling             | **4,000 patch lines** (1,257 headroom)                             |

### What the counts mean

The existing reporter verifies snapshot provenance, branch ancestry, and content
hash, then compares generated-owned Git entries with the integrated SDK. The full
remaining patch is measured, not the difference from the previous SDK release.
Added and deleted lines both count; they do not cancel. Physical line counts
include comments, JSDoc, and blank lines. They are not executable-statement counts,
and added lines are not a reliable semantic attribution of handwritten logic.
Mode-only differences and deleted generated files must remain visible if present
in a later inventory. This baseline contains no deleted mixed files.

Generated-file headers alone do not establish mixed ownership. Most `src/core/`,
`src/internal/`, `src/lib/`, provider/helper modules, legacy compatibility modules,
and `src/index.ts` are absent from this snapshot. Their additions in a raw tree
diff are outside the current mixed-file metric. They still require compatibility
review when a generated bridge imports them. The reporter excludes GitHub workflow
and action paths; those paths are outside this inventory, not certified clean.
The final checkpoint therefore requires an additional full manifest comparison
covering every generated-owned path, including generated workflows/actions, even
if schema-v2 policy activation is deferred. Zero legacy patch lines alone cannot
certify completion.

Reproduce using the unchanged repository reporter:

```sh
AUDIT_SHA=c3e69cdabaa5a03be6f3c5ae89449aa2c950dd75
python3 scripts/castiron/custom_code_report.py report \
  --repo . --base "$AUDIT_SHA" --head "$AUDIT_SHA" \
  --public --fetch --require-head-hash --out /tmp/node-mixed-audit
```

Inspect `report.json` and `custom-code.patch` in that output directory. For each
`custom_after` entry, the table below uses `git show REV:path` physical line counts
and the reporter's `added`/`removed` values. Use the same procedure at every
promotion, recording exact SDK and generated revisions. Do not change the checker
to improve the result. Local validation is diagnostic; trusted CI remains the gate.

## Complete mixed-file inventory

Workstream codes refer to the analysis and rollout below. Counts are fixed to the
baseline above; later progress belongs in the execution ledger, not a silent
rewrite of historical evidence.

| File                                                         | Current lines | Generated lines | Added | Deleted | Patch lines | Workstream |
| ------------------------------------------------------------ | ------------: | --------------: | ----: | ------: | ----------: | ---------- |
| `api.md`                                                     |         1,786 |           1,758 |    28 |       0 |          28 | D          |
| `src/client.ts`                                              |         2,885 |           2,190 |   792 |      97 |         889 | C          |
| `src/resources/admin/organization/usage.ts`                  |         7,761 |           7,760 |     2 |       1 |           3 | R          |
| `src/resources/audio/transcriptions.ts`                      |           878 |             859 |    32 |      13 |          45 | T          |
| `src/resources/audio/translations.ts`                        |           135 |             117 |    21 |       3 |          24 | T          |
| `src/resources/beta/agents/agents.ts`                        |         5,717 |           5,714 |    10 |       7 |          17 | A          |
| `src/resources/beta/agents/environments/environments.ts`     |           581 |             557 |    26 |       2 |          28 | A          |
| `src/resources/beta/agents/environments/files.ts`            |           196 |             175 |    21 |       0 |          21 | A          |
| `src/resources/beta/agents/sessions/artifacts.ts`            |           463 |             456 |     7 |       0 |           7 | A          |
| `src/resources/beta/agents/sessions/sessions.ts`             |           703 |             663 |    57 |      17 |          74 | A          |
| `src/resources/beta/assistants.ts`                           |         1,754 |           1,751 |     3 |       0 |           3 | E          |
| `src/resources/beta/beta.ts`                                 |           788 |             679 |   109 |       0 |         109 | E          |
| `src/resources/beta/index.ts`                                |           335 |             332 |     3 |       0 |           3 | E          |
| `src/resources/beta/responses/internal-base.ts`              |           136 |             139 |     8 |      11 |          19 | W          |
| `src/resources/beta/responses/responses.ts`                  |        16,044 |          16,032 |    12 |       0 |          12 | T          |
| `src/resources/beta/responses/ws-base.ts`                    |           265 |             243 |    30 |       8 |          38 | W          |
| `src/resources/beta/responses/ws.ts`                         |            72 |              72 |     2 |       2 |           4 | W          |
| `src/resources/beta/threads/index.ts`                        |            77 |              70 |     7 |       0 |           7 | E          |
| `src/resources/beta/threads/runs/index.ts`                   |            48 |              43 |     5 |       0 |           5 | E          |
| `src/resources/beta/threads/runs/runs.ts`                    |         1,271 |           1,181 |    91 |       1 |          92 | H2         |
| `src/resources/beta/threads/threads.ts`                      |         1,432 |           1,063 |   369 |       0 |         369 | H2         |
| `src/resources/chat/completions/completions.ts`              |         3,000 |           2,808 |   205 |      13 |         218 | P          |
| `src/resources/chat/completions/index.ts`                    |            50 |              49 |     1 |       0 |           1 | E          |
| `src/resources/conversations/index.ts`                       |            13 |              13 |     1 |       1 |           2 | E          |
| `src/resources/embeddings.ts`                                |           154 |             155 |    14 |      15 |          29 | P          |
| `src/resources/files.ts`                                     |           479 |             468 |    11 |       0 |          11 | H1         |
| `src/resources/fine-tuning/checkpoints/permissions.ts`       |           622 |             619 |     7 |       4 |          11 | R          |
| `src/resources/images.ts`                                    |           960 |             954 |     7 |       1 |           8 | R          |
| `src/resources/live/forks/ws-base.ts`                        |           240 |             247 |     3 |      10 |          13 | W          |
| `src/resources/live/forks/ws.ts`                             |            47 |              76 |    14 |      43 |          57 | W          |
| `src/resources/live/sideband/ws-base.ts`                     |           246 |             253 |     3 |      10 |          13 | W          |
| `src/resources/live/sideband/ws.ts`                          |            47 |              76 |    14 |      43 |          57 | W          |
| `src/resources/live/ws-base.ts`                              |           236 |             243 |     3 |      10 |          13 | W          |
| `src/resources/live/ws.ts`                                   |            43 |              72 |    14 |      43 |          57 | W          |
| `src/resources/responses/internal-base.ts`                   |           132 |             135 |     8 |      11 |          19 | W          |
| `src/resources/responses/responses.ts`                       |        12,658 |          12,541 |   166 |      49 |         215 | P          |
| `src/resources/responses/ws-base.ts`                         |           267 |             243 |    35 |      11 |          46 | W          |
| `src/resources/responses/ws.ts`                              |            72 |              72 |     2 |       2 |           4 | W          |
| `src/resources/skills/skills.ts`                             |           423 |             426 |     3 |       6 |           9 | R          |
| `src/resources/skills/versions/versions.ts`                  |           417 |             420 |     3 |       6 |           9 | R          |
| `src/resources/vector-stores/file-batches.ts`                |           332 |             298 |    34 |       0 |          34 | H1         |
| `src/resources/vector-stores/files.ts`                       |           589 |             556 |    33 |       0 |          33 | H1         |
| `src/resources/webhooks/index.ts`                            |             4 |               4 |     1 |       1 |           2 | E          |
| `src/resources/webhooks/webhooks.ts`                         |         2,245 |           2,172 |    75 |       2 |          77 | S          |
| `tests/api-resources/beta/agents/environments/files.test.ts` |            53 |              49 |     5 |       1 |           6 | D          |
| `tests/api-resources/beta/agents/vaults/credentials.test.ts` |           147 |             146 |     1 |       0 |           1 | D          |
| `tests/lib/data-residency.test.ts`                           |           193 |             192 |     1 |       0 |           1 | D          |

## Findings and intended ownership

| Workstream                      | Files | Patch lines | Owning change                                                                          | Priority / risk                                          |
| ------------------------------- | ----: | ----------: | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| H1: file/vector-store helpers   |     3 |          78 | Generate existing public helper declarations and calls into SDK helpers                | First; low–medium                                        |
| E: compatibility exports        |     8 |         132 | Generate legacy resource registration, namespace/barrel exports                        | Parallel investigation; medium                           |
| H2: Assistant helpers           |     2 |         461 | Generate polling/stream bridges and associated parameter types                         | After H1 pattern; medium                                 |
| P: parsing, streams, embeddings |     3 |         462 | Generate enriched public types and adapters; keep algorithms handwritten               | Several independent slices; high                         |
| A: Agents resource extensions   |     5 |         147 | Typed union/page facts and helper bindings                                             | Independent small slices; medium–high                    |
| T: audio and beta event types   |     3 |          81 | Schema facts and ordered generic/overload emission                                     | Independent; high type-compatibility risk                |
| R: request semantics            |     5 |          40 | Correct owning schema/configuration and request rendering                              | Independent per boundary; security review where relevant |
| W: WebSocket adapters           |    12 |         340 | Generate current adapters and preserve lifecycle/credential contracts                  | Later; high                                              |
| C: client runtime boundary      |     1 |         889 | Generate supported client composition/delegation with handwritten auth/provider owners | Last file to reach zero; highest                         |
| S: webhook signatures           |     1 |          77 | Generate current async verification surface and helper delegation                      | Separate security-reviewed slice                         |
| D: reference and tests          |     4 |          36 | Generate accurate helper reference and valid examples/test bodies                      | Alongside owning features                                |

`client.ts` accounts for 32.4% of the patch. Together with Assistant Threads, Chat
Completions, and stable Responses, four files account for 1,691 lines (61.6%).
Counting just the largest files would miss 43 other conflicts; reducing patch size
and eliminating mixed files are separate progress measures.

### H1 — Files and vector stores

`Files.waitForProcessing` already delegates to `src/lib/file-processing.ts`.
Vector-store polling already delegates to `src/lib/vector-store-polling.ts`, and
batch uploading to `src/lib/vector-store-upload.ts`. The missing compiler ownership
is primarily declarations and small composition methods:

- Generate `waitForProcessing(id, { pollInterval = 5000, maxWait = 30 * 60 * 1000 } = {})`.
  Preserve the destructured second argument, defaults, `Promise<FileObject>`,
  method placement, and current awaited delegate. This is distinct from the
  existing `pollIntervalMs`/request-options polling signature.
- Generate vector-file `createAndPoll`, `upload`, and `uploadAndPoll`; preserve
  `Uploadable` imports, purpose `assistants`, method dispatch through `this`, exact
  request-options identity, and error propagation.
- Generate batch `createAndPoll` and `uploadAndPoll`; preserve file ordering,
  `fileIds = []`, `maxConcurrency`, and the existing handwritten scheduler.

Extend existing typed polling/helper facts where they fit; do not add executable
TypeScript strings to configuration or invent a general wrapper DSL for one method.
The current compiler already has typed polling support. Check merged upstream
work before creating any replacement. The 78-line target is an upper bound until
normal generation proves the resulting patch reduction.

### E — Compatibility exports and registration

Generate the **shipped** symbols and identities: `AssistantStream`, legacy
`Beta.Realtime` instance/static/type members, Thread poll/stream parameter exports,
chat stream/runner exports, and the Conversations/Webhooks wildcard barrels.
Legacy realtime module bodies are handwritten-only in this snapshot; only their
mixed registration/barrels are counted here. Do not regenerate or remove those
bodies as an incidental cleanup. A new handwritten wrapper subclass would change
identities and prototype ownership; use the current classes.

Some files combine export changes with helpers owned by H2/P. A partial export
change may reduce lines without eliminating that file. Resolve the complete export
graph, including declaration namespace merging and source import subpaths. Prefer
existing compiler export projection; add a typed export fact only if needed.

### H2 — Assistant Threads and Runs

Generate existing create/poll/submit-tool-output/stream helpers and their parameter
interfaces. Keep `AssistantStream` and polling algorithms handwritten. Thread
helpers account for 369 lines and Runs for 92. Preserve overload order, streaming
and non-streaming return types, SDK class namespace aliases, calls on overridden
resource methods, and options/header precedence. Complete E's dependent exports
and the matching `api.md` entries with this slice. Split Threads and Runs if their
shared projection is already available.

### P — Chat Completions, Responses, and embeddings

Use separate PRs for these three resource files:

- Chat: parsed types, `parse`, runner/stream methods and reexports belong in
  generated declarations and bridges. Keep algorithms in `src/lib/`. Preserve
  custom tool-call chunks, nullable `finish_reason`, and nullable legacy
  `function_call`; their source schema fixes are separate from helper emission.
- Responses: generate parsed output variants from the canonical output union,
  `parse`/`stream` bridges, and `output_text` enrichment on both create/retrieve.
  Preserve output/object identity and `APIPromise` behavior. Retain
  `ResponseFunctionWebSearch.Find`, every existing `ResponsesClientEvent` nested
  alias, existing optional fields, streaming error typing, and tool-choice members.
  Do not replace the public union with a new handwritten list. Reconcile schema
  documentation/field differences against the shipped declarations individually.
- Embeddings: retain the explicit-base64 overload and current default float
  decoding behavior, with the handwritten `createEmbedding` implementation. Keep
  `APIPromise`, raw-response behavior, request metadata, and options identity.

The SDK's current public declarations are the compatibility baseline even where
fresh generator output appears cleaner. No type tightening is allowed here.

### A — Agents extensions

Treat each file's responsibility separately:

- `agents.ts`: preserve the exclusive prewarmed environment variant, exported
  nested name, and existing `never` fields; express the relationship as a source
  schema/compiler fact rather than weakening the public union.
- `environments.ts`: retain the runtime `EnvironmentInfosPage` class and its
  `object`, `first_id`, and `last_id` fields. Reverting it to a type alias removes a
  runtime export. Generate the existing page shape from typed pagination facts.
- Environment `files.ts`: generate `prepare`/`upload` calls to the current helpers
  and the complete executable create example.
- Session `artifacts.ts`: generate the existing `forResult` bridge.
- `sessions.ts`: preserve current create/stream/result collection bridges and
  enriched result types through their existing handwritten owners.

The two generated Agents test edits supply valid request bodies: inline file data
and credential-update `metadata: {}`. Fix generation's request/example selection;
reverting the tests would lose coverage or create invalid requests.

### T — Audio and event types

Audio rendering must preserve response-format generic defaults, ordered overloads,
string returns for text formats, streaming behavior, and model metadata. Do not
"correct" or tighten an existing fallback overload as part of ownership cleanup.
Generate the stable/beta Responses WebSocket streaming-error variants with the
current optional `stream_id`; stable overlaps P, beta is its own 12-line file.
Prefer the authoritative schema for wire variants and typed compiler projection
for SDK-only overloads. Protect both inferred and explicit generic use.

### R — Request semantics

These small patches are behavior-critical and should not become one omnibus PR:

- Usage decisions: omit only explicit null optional filters as currently shipped;
  preserve `0`, `false`, empty strings, omitted values and request overrides.
- Fine-tuning checkpoint permissions: preserve admin-key authentication on all four
  methods. Correct authoritative security metadata; verify custom headers and
  provider behavior without exposing credentials.
- Images: preserve existing model metadata merge and nullish behavior; do not
  replace caller metadata or conflate absent model values with empty strings.
  For `images.edit`, normalize only an explicit `safety_identifier: null` in the
  **effective body after `options.body` precedence** to `undefined` before multipart
  serialization, so the field is omitted. Preserve non-null strings (including
  `''`), omitted/undefined values, unrelated fields, streaming options, and caller
  object contents. Keep `tests/lib/image-safety-identifier.test.ts` as a required
  request-boundary regression for this slice: direct nulls and body overrides,
  streaming/non-streaming requests, eager/lazy uploads, own emitted fields,
  effective-body read behavior, and caller immutability. Do not extend this
  normalization to JSON image generation, Responses, or Chat Completions.
- Skills and versions: preserve upload filenames and current request-option
  normalization/precedence. Generate through the owning multipart policy; do not
  globally change filename rules for other resources.

These may be configuration/schema-only changes rather than compiler work. Inspect
current upstream inputs and open changes first; no endpoint-specific guessed lists.

### W — WebSocket behavior parity

The six stable/beta Responses transport files preserve specialized credential
handling, event payload/size bookkeeping, hooks, and exception behavior. The six
Live/forks/sideband files remove or alter generated credential/reconnect behavior.
These are not safe mechanical reversions. Generate adapters to existing handwritten
transport owners only after contract tests establish parity for current behavior.
Preserve current and legacy import paths, protected methods, event object identity,
header removals, retries, cancellation, listener ownership, and large payloads.

Keep stable/beta implementations aligned through an owning compiler fact or shared
runtime boundary. Do not duplicate a transport implementation to simplify output.
Reconcile open realtime work, including PR #2982, before touching overlapping
lifecycle behavior. Pending work must not be replaced by a duplicate migration PR.

### C — Client runtime ownership

The 889-line `client.ts` patch spans callable credentials, providers, workload
identity/X.509, cloning, protected options/hooks, WebSocket header construction,
request-local state, transport security and request/response lifetime behavior.
Much of the implementation already delegates to handwritten auth/provider modules.
Moving another large block into a helper does not by itself make this file clean.

Migrate in contract-sized slices: (1) options/types and callable credential hooks,
(2) provider construction/cloning, (3) workload identity/X.509 integration,
(4) transport/request-lifetime hooks and diagnostics. Use existing handwritten
owners and generate the current composition points. Keep one client class and
preserve constructor, class-field initialization, private-state lifetime, protected
extension points and provider isolation. Do not introduce a new base class or
mixin merely to satisfy the metric. Audit current merged compiler implementations
before proposing additional hooks; several lifetime fixes are already upstream.

The generated data-residency test's `@ts-expect-error` documents an intentional
Azure clone type restriction. Its owner must emit that compile-time assertion
without weakening the runtime check or changing the provider's types.

### S — Webhook verification

Preserve async `unwrap(payload, headers, secret, tolerance)` with verification,
async `verifySignature`, default client secret/tolerance, existing errors, header
normalization and required crypto checks. The snapshot's synchronous parse-only
`unwrap(body)` is not the shipped API and must not replace it. Generate the current
surface around `src/lib/webhook-signature.ts`, with focused security review and
existing signature regressions. Preserve the Webhooks barrel exports in E.

### D — Reference and test generation

Generate all current helper reference entries from the same facts as the methods.
`api.md` also contains a duplicate Safety section; removing that duplicate is a
separate safe documentation cleanup only after confirming the canonical entry
remains. Do not claim the whole 28-line doc patch disappears from H1 alone.
Fix the three generated tests through their owning producers, retaining valid
bodies and meaningful compile-time coverage. Handwritten regression tests remain
handwritten; do not relabel them to change the metric.

## Compiler architecture and implementation rules

The production compiler lives under `api/castiron` in the OpenAI monorepo. The old
standalone Castiron checkout is archived; the experimental Node generator is not
the production owner. Relevant source boundaries are:

- `castiron-oas-transform`: authoritative configuration validation and schema facts.
- `castiron-ir`: typed facts, including TypeScript polling bindings.
- `castiron-compiler`: projection from typed inputs into SDK declarations/facts.
- `castiron-render-typescript`: resource, client, barrel, WebSocket, reference and
  generated-test rendering.

Changes should follow configuration/schema → typed facts → renderer. No arbitrary
source-code injection, SDK post-processing patches, new ownership exclusions,
hand-maintained endpoint lists, or second runtime implementation. Intentional
OpenAI-specific output must use the existing `CodegenProfile::OpenAI` branch;
existing Stainless parity fixtures and expected trees are immutable.

Compiler changes must merge to monorepo `master` before SDK promotion. Preview
generation for testing is allowed; promotion with an unmerged compiler is not.
Identify the actual compiler binary/source revision used, not merely the revision
of a nearby checkout. Configuration-only changes outside the compiler have their
own review path, but do not override compatibility checks.

## Rollout and parallel execution

The detailed task checklist is [todo.md](todo.md). Each workstream is a queue of
small, coherent PRs, not one large PR per row of the workstream table.

1. Land this inventory/plan without runtime changes. Capture a repeatable baseline
   and audit already merged compiler work to avoid duplication.
2. In independent worktrees, implement H1's file-processing signature and E's
   smallest compatibility-export slice. A broader vector upload slice follows
   the reviewed binding model, rather than forcing unrelated methods into it.
3. After each compiler slice lands, generate an isolated SDK preview using the
   merged compiler, compare with the **current shipped SDK**, and promote only
   the compatible output through normal Castiron review/promotion. The three-way
   merge must preserve every unrelated custom patch.
4. Run H2, P, A, T, R, and S as independent slices when their touched compiler
   owners are disjoint. Establish shared facts in one prerequisite PR before
   dependent renderer changes. Serialize overlapping source config or renderer
   edits; rebase and rerun affected tests after a dependency lands.
5. Treat W and C as dedicated staged queues. Their prototypes/hooks/authentication
   contracts must be covered before generated adapters replace handwritten bridges.
6. Once the legacy count reaches zero, require the full ownership certification
   below before declaring completion. Then separately propose a budget-only PR to
   reduce the ceiling and optionally activate supported strict generated ownership.
   Do not combine policy activation with SDK/compiler implementation or alter the
   trusted checker. Preserve ordinary CODEOWNERS and review requirements.

Parallel compiler reviews are safe; SDK promotions touching the same files or
checkpoint lineage are serialized. An upstream merge is progress, but does not
reduce this repository's count until generated output is integrated and verified.
No new customization budget is reserved by this plan.

## Compatibility and verification gates

For every slice, write the current contract and expected generated diff before
editing. Add focused regressions at the affected public boundary where missing.
Compiler projection tests should fail without the new capability. For pure
ownership changes, the preferred SDK result is byte-identical declarations and
runtime output with a different verified generated baseline.

Before an SDK promotion:

- Compare all affected emitted `.d.ts` files and public subpath exports with the
  current base: nested namespaces, overload order, generic defaults, optionality,
  parameter names/defaults and protected hooks. Runtime export-name checks alone
  are insufficient. Existing `scripts/detect-breaking-changes` helps but does not
  prove the entire contract; run it in a disposable checkout because it restores
  tests from the base.
- Compare packed CJS/ESM exports, aliases and constructor identity. Exercise
  providers, beta/legacy surfaces and equivalent streaming/non-streaming paths
  when affected. Reject unexplained differences rather than updating expectations.
- Run focused regressions first, then the repository's pinned formatter/linter,
  `pnpm exec tsc`, `pnpm build`, and `./scripts/test` as appropriate to the slice.
  Keep generated and handwritten test coverage. Test compiler facts, renderer
  output, and immutable Stainless parity using the compiler's prescribed Bazel
  workflow. Report infrastructure failures separately from verified passes.
- Follow `NODE_VERSION_POLICY.md`: validate affected packed entrypoints on exact
  Node 22.0.0, supported Node lines, TypeScript floor 4.9 and the pinned compiler;
  exercise affected browser/worker/Bun/Deno/bundler integrations. Do not infer floor
  compatibility from a recent Node release. Optional integrations must remain
  optional, tested both present and absent if their import boundary changes.
- Retain focused lifetime/security tests for uploads, authentication, headers,
  serialization, webhook verification and WebSockets. Keep synthetic inputs and
  legitimate large payload coverage; do not add arbitrary limits.
- Run the unchanged trusted custom-code accounting against exact candidate and
  current main. Require no new mixed files and a verified reduction for each
  drawdown promotion. Record both file count and added/deleted patch lines.
- Obtain independent code review; require relevant maintainer/security review for
  sensitive boundaries. Open ready PRs, preserve normal CI/review/merge gates,
  and never use agent credentials to approve a budget increase.
- Request review for every PR and Delta in a deduplicated root message in
  `#sdk-reviews`, including compiler changes. Native reviewer requests supplement
  this Slack request. Wait for Conductor state updates and react to them; do not
  set up independent polling.

### Final ownership certification — mandatory

The final checkpoint must compare the complete compiler-owned manifest from a
provenance-verified generated checkpoint with the exact integrated SDK commit.
Use the trusted compiler/checker's `verify_generated` comparison for all owned
paths, including generated `.github/workflows/` and `.github/actions/` files that
legacy patch accounting excludes. Verify file bytes, Git modes, the manifest
itself, and retired generated paths using the previous verified checkpoint.
Handwritten files and inherited SDK-owned governance remain outside generated
ownership; do not broaden ownership to improve the result.

This comparison is required **regardless of schema-v2 policy activation**. A
policy-gated verifier invocation that returns success without comparing paths
under schema v1 does not satisfy it. Use the existing trusted comparator directly
or an unconditional compiler-owned diagnostic; if that comparison or a complete
verified manifest is unavailable, completion is blocked until the owning compiler
support lands and normal generation supplies it. Do not edit policy, manifests,
metadata, or exclusions to manufacture a passing result.

Record the compiler/verifier revision, candidate commit, current and previous
verified checkpoints, complete owned-path inventory and an empty violation result.
A zero legacy mixed-file report and a passing full ownership comparison are both
required. Strict policy activation may remain a later isolated policy-only PR;
full ownership certification may not be deferred.

## Execution ledger and event handling

| Item                       | Status                            | Evidence / next action                                                                                                                                                              |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline inventory         | Verified                          | 47 files / 2,743 patch lines at the pinned revisions above                                                                                                                          |
| Documentation PR           | Merged                            | [PR #2985](https://github.com/openai/openai-node/pull/2985) merged as `bd036b4c3d9ae78982ed0c632d54da6f9cd7f6d3`; Conductor verified merge and green post-merge workflows           |
| H1 file-processing binding | Published ready upstream          | Independently reviewed; normal hooks passed; local Bazel blocked before compilation; expected 1-file/11-line reduction after verified promotion                                     |
| E export projection        | Published ready upstream          | Independently reviewed; normal hooks passed; consumer type/runtime regressions added; local Bazel blocked before compilation                                                        |
| SDK drawdown               | Compiler-dependent slices waiting | Both initial compiler Deltas remain open and require human contract approval; no SDK output promoted                                                                                |
| D: duplicate API reference | Published ready for review        | [PR #2987](https://github.com/openai/openai-node/pull/2987); preserve legacy fragment links; diagnostic candidate: 47 mixed files / 2,735 patch lines, pending trusted CI and merge |
| Continuation               | Awaiting Conductor state updates  | Every PR/Delta requires a deduplicated root request in #sdk-reviews; no independent polling                                                                                         |

A deduplicated root `#sdk-reviews` request was posted on 2026-10-19 covering the
plan PR and both initial compiler Deltas. Future changes require the same review
request. Conductor delivered an ownership-verified message for this visible
conversation
at head `ebb2d08aeadfff247380ba8cb3bf1b8ceaebd99f` on 2026-10-19, establishing the
routing receipt. Continue to wait for Conductor state messages and react here;
earlier task-tool connection failures do not require independent polling.

The independent documentation slice in [PR #2987](https://github.com/openai/openai-node/pull/2987) removes the duplicated Safety/Alerts
reference block while retaining the canonical generated Cases/Alerts content.
Explicit anchors preserve the existing `#safety-1` and `#alerts-1` fragment URLs;
canonical `#safety` and `#alerts` targets, helper references, and all unique HTML
link destinations remain available. The two compatibility anchors remain custom
content until the owning reference generator emits them; do not claim `api.md`
is clean or drop those links to reduce the count.

Only `api.md` and this transition ledger/checklist change; no SDK code, generation
metadata, ownership rules, checker, or budget policy changes. Main also received
API generation PR #2984 while the plan was queued, so the candidate was measured
against its current pinned public snapshot
`b8300062d8af5a9504d00e3b0257a65630c2898d` at SDK base
`bd036b4c3d9ae78982ed0c632d54da6f9cd7f6d3`. Diagnostic Git numstat using the
existing reporter's generated ownership reduces `api.md` from 28 to 20 custom
patch lines and the full patch from 2,743 to 2,735, with all 47 files still mixed.
A bounded attempt to rerun the full reporter timed out; no new snapshot/hash or
trusted candidate-budget pass is claimed. Trusted CI and actual merge must confirm
the reduction before it is recorded as achieved. The historical baseline above
stays fixed. Pinned Oxfmt and whitespace checks, canonical-section/helper/link
comparisons, GitHub GFM rendering of the legacy anchors, and independent review
passed. A deduplicated root `#sdk-reviews` request and native SDK team review
request were posted for #2987 on 2026-10-19. Continue reacting to Conductor state
notifications; no independent polling is requested.

Validation recorded during this audit:

- `pnpm install --frozen-lockfile` passed using Node 24 and pinned pnpm, without
  tracked dependency changes.
- The pinned `oxfmt --check` and `git diff --check` passed for both Markdown files;
  all 47 table rows and relative document links were checked independently.
- `./scripts/test tests/lib/file-processing.test.ts tests/generated-resource-helpers.test.ts tests/resource-exports.test.ts`
  passed: 111 tests across three files. These establish the unchanged SDK baseline;
  they do not verify newly generated compiler output.
- `python3 -m unittest discover -s scripts/castiron -p 'test_custom_code*.py'`
  passed: 95 tests, one skip.
- The initial verified full custom-code report succeeded. A subsequent local
  candidate budget check stalled in `git cat-file --batch`, including a retry
  outside the sandbox, and was stopped. No candidate-budget pass is claimed.
- Review follow-up: `./scripts/test tests/lib/image-safety-identifier.test.ts`
  passed all 37 existing request-boundary regressions for the documented Images
  contract; the follow-up changes only this plan and its task checklist.
- Both initial compiler implementations received separate independent read-only
  reviews without blocking findings. Compiler test results and actual promotion
  compatibility remain separate prerequisites; review does not substitute for them.

For each resulting PR/Delta, record the link, exact head, compiler dependency,
current-head validation, review outcome, actual merge commit, generated snapshot,
and measured before/after counts here or in its linked task. Use Conductor state
updates to resume this owning task, rather than polling pending CI/reviews. On a
failure or actionable feedback, inspect evidence, fix the owning input/compiler,
rerun checks and independent review, push, then explain addressed feedback. On
verified compiler merge, unblock its SDK generation; on verified SDK merge,
remeasure and start the next unblocked slice. CI green and queue enrollment are
not proof of merge. Do not react to stale-head results or duplicate a repair already
being handled. Preserve this plan's zero-breaking-change requirement on every wake.

Completion means verified **zero legacy mixed files and zero custom patch lines**,
a **passing full ownership certification of every manifest-owned file including
generated workflows/actions**, all public behavior/type/export compatibility gates
satisfied, no accounting bypass, and no remaining unpromoted compiler prerequisite.
Track handwritten code size separately so a clean mixed-file metric is not mistaken for eliminating all
handwritten SDK code.
