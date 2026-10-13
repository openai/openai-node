# Installed browser helper conformance

This probe calls the public browser, computer, and Responses
runner entrypoints in an **installed** SDK package. It uses synthetic data and an
in-process fetch transport; it needs no API credential or browser dependency.
Each case asserts effects and replayed output, then writes a JSON receipt.

Run from any directory with Node 22 or later, Git and tar available. Provide absolute
paths to a directory containing an installed package under `node_modules/openai`,
its npm tarball, this source checkout, and the commit whose three helper sources
match that package:

```sh
node /path/to/checkout/examples/browser-conformance/consumer.mjs \
  --consumer /path/to/installed-consumer \
  --archive /path/to/openai.tgz \
  --source /path/to/checkout \
  --package-head 'FULL_COMMIT_SHA' \
  --format cjs > node-cjs.json
```

Repeat with `--format esm`. Do not use the SDK repository itself as the consumer.
The probe requires resolved imports inside the supplied consumer, compares
installed CJS or ESM entrypoints to the tarball, and compares helper source
hashes to the tarball, current source files, and the specified commit. It exits
nonzero on mismatch or any failed case. The receipt records these paths, hashes,
the current source HEAD, the verified helper-source commit and every case ID.
It does not prove that all tarball files came from that commit.

`vectors.json` is byte-identical to the Python SDK's conformance catalog.
It supplies member calls, invalid states and arguments, strict consent values,
entry policies and mixed tool wire items. `boundary_ids` names the shared checks
whose getter/callback mechanics are language-specific. The three normal mixed
modes and two interruption modes use each language's own synthetic transport.

Missing required policies reject at construction before any observation or action.
Removing a required policy after registration returns a controlled refusal with
harmless before/after state observations and no action. The other checks cover
snapshots across getters/awaits, refusal, cancellation, error redaction, and replay
of reasoning, browser images, ordinary function and native computer outputs.

These receipts verify the supplied installed package and runtime only. They do
not establish hosted CI, live API, real-browser, provider or competitor parity.

The 14 `ledger:*` cases also run through installed public Responses helpers.
They check write-before-dispatch, thrown/nested and partially returned effects,
recorder failures (including a lost acknowledgement), refusal of unresolved
browser or eager calls, and explicit iterator close. A successful boundary
case resumes with original call IDs and multimodal output exactly once plus a
fresh caller observation, then rejects a stale revision in the caller's own
save callback. Native history, registration, per-request retry isolation and
the saved request budget are checked before more effects or HTTP. The recorder
here is an in-memory fixture. These cases do not prove durable storage,
cross-process locking, exactly-once provider effects, or semantic freshness of
the caller observation. Those guarantees require the caller's environment.

The seven `rich-read:*` cases check typed reports from read_page, find and
get_page_text: known-field projection, a final-state mutation, fatal malformed
output, large reports, text-only refs, and unchanged legacy JSON strings. The
six `selective:*` cases check mixed SSE order, result replacement after server-tool deferral, explicit empty vs omitted or
null timing policy, ordinary and native tools both named computer, pending
ledger refusal and changed completion. Only eligible pending ordinary output
can be supplied; previous effects are retained on failure.

The seven `budget:*` cases send native HTTP and SSE through the public runner.
They bound replay bytes and images, preserve the full ledger and require the
runner's own dropped-ID receipt even after the policy edits its snapshot.
Protected safety and latest screenshots, invalid choices, old-ID replay,
remaining request lifetime on fresh resume, and a held policy abort are checked
before any additional admission or effect.

Each receipt lists the case IDs for its module format. These checks validate SDK boundaries
with synthetic drivers. They do not prove DOM privacy, remote action identity,
durable recording or cancellation of arbitrary user callbacks.
