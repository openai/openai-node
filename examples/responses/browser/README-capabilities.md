# Scoped reads and guarded pointer input

These optional examples use a disposable local browser and fixed pages. They make no API
requests and require no API key or model. The scoped exercise chooses between repeated
sections with the same control labels. The pointer exercise checks clicks, a modifier drag,
and a timed key hold on one launcher-owned canvas.

Download and unpack **Source code (zip)** from the
[Node SDK release page](https://github.com/openai/openai-node/releases/latest).
Keep the `examples` folders together. From the unpacked `examples` directory, install the
SDK and Playwright, then run the exercises:

```sh
npm install --no-save openai@latest playwright@1.63.0
npx playwright install chromium
node responses/browser/exercise-scoped.mjs
node responses/browser/exercise-capabilities.mjs
```

The scoped result reports `picked: "south"`, bounded depth, privacy, stale-ref refusals, and
unchanged legacy behavior. The pointer exercise prints `PASS` lines after checking actual
events and state: trusted right, middle and double clicks; modifier drag; timed hold and
released keys; rejection of a replaced canvas; and retirement of only the cancelled owner.

## Scoped reads in this driver

The owned driver implements `read_page_scoped` only when configured with `ownedFixture`.
Select it explicitly, for example with
`members: ['read_page', 'read_page_scoped', 'click']`, and provide `confirm` for `click`.
Null `root` discovers named semantic sections in the main document: `section`, `article`,
`nav`, or an element with `role="region"`. The example reads names from direct
`aria-label` attributes. It reports child frames as `unsupported_root`; it does not issue
scope refs inside frames.

Select a returned scope ref for another `read_page_scoped` call. Choose an element ref
from that result when you need to click. Scope refs themselves cannot be clicked. Hidden,
replaced, renamed, stale, and cross-tab refs fail. The scan retains its privacy and total
work limits, and `depth` bounds traversal within the selected root.

## Guarded pointer factory

The launcher must create the page and retain the original element handles for the record and
any secret-free canvases it created. Pass them to
`await base.createOwnedBrowser({ signal, record, canvases })`. The optional `canvases` list
must not come from a model ref or page-supplied selection. Only the original allowed
canvases are eligible; replacing one does not transfer permission.

The returned pointer object provides `screenshot`, `click_at`, `drag_path`, and
`hold_keys`. As in `exercise-capabilities.mjs`, combine it with the base driver so it
retains `state()`, then select
`members: ['screenshot', 'click_at', 'drag_path', 'hold_keys']` and supply `confirm`.
The three actions stay hidden if you omit `members`.

Call this pointer object's screenshot before **each** gesture. It grants one gesture
against the checked current view. Coordinates remain full-viewport CSS pixels after a
zoom. The factory reuses the existing public-pixel, record, bounds, and gesture checks.
Held keys must be released when the operation ends; if cancellation or failure prevents a
safe release, the driver retires its owning context. Other contexts remain separate.

Default screenshot and native pointer paths still deny canvases. These browser methods do
not add support for native computer actions that the existing adapter refuses. The checks
apply to a fixed fixture whose launcher guarantees that secrets cannot appear, including
during capture; they cannot redact arbitrary websites. The DOM checks cannot inspect
closed shadow roots. Grant public pixels only for templates you control throughout the run,
including any components they create. See the
[SDK browser contract](../../../docs/browser.md#opt-in-to-scoped-reads-and-pointer-input)
for method arguments, bounds and result types.

## Diagnose or script the local fixture

From the SDK `examples` directory, run:

```sh
node responses/browser/exercise-sensitive.mjs
```

This uses a real local browser and makes no model requests. The optional factory
`createSensitiveDriver(context, { url, diagnostics: true, scripts: true })` requires an empty context
and an exact local fixture URL. Enable only the methods your task needs, then
select `read_diagnostics` or `run_script` in the SDK helper and supply confirmation.

Diagnostics report bounded console levels and network status, without message
contents or request URLs. The script exercise changes an SVG shape and reads a
synthetic value. It also checks blocked network access, stale refs, cancellation,
and retirement after a timeout. Scripts have the page's privileges; this example
is limited to a fresh, secret-free fixture and does not make arbitrary code safe.
