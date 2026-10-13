# Pointer tasks in a public fixture

The browser helper accepts an optional `zoom` driver member.
It takes `{ tab_id, region: [x0, y0, x1, y1] }`, with four nonnegative safe
integers and positive width and height. The driver returns an `input_image`
for a function output; the helper adds text and state. Like a screenshot,
a zoom result must contain at least one nonempty `image_url` or `file_id`.
Both sources may be present. The other supported fields are `type`,
`detail`, and `prompt_cache_breakpoint`. Omit `detail`, set it to `null`, or
use `auto`, `low`, `high`, or `original`. A cache breakpoint may be
`{ mode: 'explicit' }` or `null`. See the [image return contract](browser.md#driver-contract).
Zoom appears in the tool list only when the driver implements it and the
member selector enables it. To require confirmation, include `zoom` in
`confirmReads`. URL policy callbacks do not run for zoom.

The optional Playwright driver in `examples/responses/browser/driver.mjs`
can use a single owned browser session for reference actions and native
computer tasks. This is for a fixed, trusted, disposable fixture. At launch,
grant its entire viewport separately from its readable DOM fields:

```js
const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
const driver = createBrowserDriver(context, {
  ownedFixture: {
    urls: [installedFixtureURL],
    publicViewports: [installedFixtureURL],
  },
});
const tabId = await driver.new_tab({ url: installedFixtureURL });
// The launcher knows which record it just mounted. Capture this once before handoff.
const record = await context.pages()[0].locator('#record').elementHandle();
const signal = controller.signal;
const adapter = await driver.createOwnedComputer({ record, signal });
const computer = new ComputerToolset(adapter);
// Pass the SAME signal to ComputerToolset.execute or the runner.
```

The record is a launcher-held ElementHandle. Its original document and node
must still exist at each gesture. An equal-looking replacement, a model
supplied reference, and a `data-record-id` attribute cannot grant native
input. Borrowed drivers have no owned-computer factory. Unconfigured owned
drivers expose no zoom; their screenshot and factory refuse without a pixel
grant. A viewport grant must be a subset of installed URLs. It cannot be
inferred from `publicValues`.

The example refuses whole-view pixels with input, textarea, select,
editable, private, child-frame, shadow/custom, canvas or media content. The
pre/post capture scan counts hidden nodes and refuses on its 2,000-node
budget. This is a conservative fixed-fixture check, not a redaction system:
the trusted fixture must never insert secrets during capture. It cannot
safely export pixels from arbitrary sites. Screenshots use CSS pixels even at
DPR2; each PNG is limited to 4,194,304 pixels and 16 MiB. Zoom crops the
requested region without upscaling. Coordinates after zoom still refer to
the full viewport, never to the crop's origin.

For native input, first request a full screenshot using the computer helper.
Only the adapter's own completed full capture arms one gesture; browser zoom
and screenshot do not. A fresh screenshot cannot replace the original
document/record. Ref reads, ref actions, navigation, handoff or cancellation
invalidate the native view. Native admission revokes existing structured refs.
Native batches allow one gesture before the helper's final screenshot: a
second gesture in the same call refuses, after the first may already have had
effects. Do not retry an incomplete call automatically.

The fixture supports move/hover, left or right click, and a bounded drag path
of 2–100 integer points. No modifier or Shift is allowed. Enter and Escape
require a visible, enabled `button[role=menuitem]` inside the original
record to own focus. Double click, arbitrary click counts, other keys, type,
scroll and wait refuse before input; use the existing browser tools for form
tasks. During gestures, uncertainty releases attempted buttons and keys,
then retires the context. Release can itself trigger events; retirement does
not mean rollback. Native calls contain no screenshot ID, so they cannot
prove which older image a model used to choose otherwise valid coordinates.

Follow the [package and browser setup](../examples/browser-use-demo/README.md#setup)
from an extracted release source archive. The context and network boundaries are described in
[`README-owned.md`](../examples/responses/browser/README-owned.md):

```sh
# Run from examples/
node responses/browser/exercise-pointer.mjs
```

It uses the installed helper and real Chromium against a fixed loopback server,
with no API calls. The independent outcome checks cover crop content at
DPR1/2, menu activation, real drag/drop, stale and private views, capture
concurrency, and release after observed downs.
