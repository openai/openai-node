# Browser, desktop and mixed workspace example

For installed Chrome on Linux, see [Choose a local browser](../../docs/browser.md#choose-a-local-browser).

Open a local dashboard and choose **Browser**, **Isolated desktop**, or **Mixed**.
Browser has six synthetic tasks and offers Responses or Decisions. Desktop
and Mixed each have one fixed task and use live Responses only. Mixed routes
D-2201 in a host browser, approves one local receipt, and saves it in the
separate guest editor. Take and Return keep both workspaces in that same task.

Open the private link printed by the server in your terminal. It grants control
of this local demo, so do not share it. The page removes the link's token from
the address bar at once; reload requires reopening the private link. Redirected
output shows only the public origin and cannot authorize controls. Other local
users can load the public help page, but cannot view runs or issue controls
without the link. This does not protect against someone with access to your
terminal or the same OS account.

Open the dashboard in a fresh browser profile so previously installed service
workers cannot control it. The server chooses an available local port; use the
printed link each time. This also applies if you set a fixed `DEMO_PORT`.

## Choose a starting point

Start with **Book a table** in the dashboard. Use the smaller reader when you want
one file to adapt before adding approvals or desktop control.

| What you want to build      | Example to start from                                         | What it teaches                                                 |
| --------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| Read and answer a question  | [Local page reader](../responses/browser/README-read-only.md) | A partial driver, allowed navigation and current page evidence  |
| Make an approved edit       | Book a table                                                  | Form inputs, fresh targets, approval and a saved-result check   |
| Apply business rules        | Invoice review, stock or service                              | Keep incorrect approved results visible as unverified           |
| Transfer a bounded file     | [File intake](../responses/browser/README-files.md)           | One-use permission, expiry and a checked receipt                |
| Combine browser and desktop | [Mixed task](../responses/browser/README-mixed.md)            | Separate workspaces, human handoff and one request budget       |
| Carry evidence across steps | [Release review](../responses/browser/long-workflow.md)       | Prior observations, complete Decisions choices and verification |

The npm package supplies the SDK, not these example files. Use a source archive
from the latest SDK release.
The checks below have separate scopes; a controlled test does not prove a
complete native or live-API dashboard run.

The tasks cover support triage, a reservation form, invoice review, substitute stock, a service form, and file intake. Reservations, invoice approvals, shipments, service submissions, and file selection require operator consent. Stop interrupts the run. The first three tasks check the resulting browser state. Stock, service, and file intake check the local server's saved records, so changed page text cannot claim success.

For stock, the agent chooses a substitute that matches each order's requested colour. Each approval names the order and SKU. The server records the shipment only after the checked browser click returns. A stale control, refusal, or Stop cancels a pending shipment. Human control can inspect this task; shipments require the agent's approval flow.

For service, the agent fills a visit date, technician and note. Approval names the job and shows those actual field values. The server saves only that exact approved request after the native checked submit action returns. An approved wrong value remains a saved, unverified visit; it is never silently removed. You can inspect or fill the form during human control. Saving requires the agent's approval flow.

File intake requires a separate opt-in before Start. Its one-use approval expires after 30 seconds. The upload owner can select only the generated synthetic note for INTAKE-501. The fixture sends its bytes to the local server. The server saves a receipt only after native selection passes the original-control check. Selection without a matching receipt stays unverified. Stop waits for pending file work and removes its private temporary files. Take control is disabled here because a human could open the local file chooser. This local result does not prove uploads to external or production systems.

Page reads use the SDK's bounded `BrowserReadV1` report, with visible text, control roles and opaque refs.
The launcher permits values and options for four synthetic reservation fields or three synthetic service fields at their exact owned Task URL and record.
Page attributes alone cannot grant that permission. Internal record metadata stays inside the driver;
business IDs already visible on the page remain readable. Read limits and omitted coverage are explicit.

The viewer shows actual pixels from the selected private browser or Linux
guest, including changes between tool calls. It requests the latest frame
about every 250 ms and shows its age. Desktop captures share one bounded
queue with guest actions, so a request does not guarantee a new frame at
that rate. Ended runs show a labeled saved screenshot when one exists.
Stop and refusal end access to live frames.

Use **Saved checkpoints** to inspect earlier screenshots from the current
run. The label shows the checkpoint number, capture time, owner and Task,
Notes or Desktop view. The viewer reports omitted checkpoints: it keeps at
most 12, with limits of 1 MiB per image and 8 MiB total. A replaced run or
evicted image cannot be retrieved as its latest frame.

Saved images are view only. Input, takeover, return-to-agent and approvals
stay disabled while viewing one; Stop remains available for an active session.
**Return to current view** waits for fresh session state and a current frame
before restoring eligible controls. Export excludes both saved images and
their checkpoint metadata.

If the connection fails, the viewer hides pixels and controls until it obtains
fresh state. Slow state and image reads time out after five seconds. A lost
dashboard connection does not prove that the guest stopped. A human-held run
still expires after five minutes. Open the new private link after restarting the server.

## Setup

Use Node.js 22 or later. Download **Source code (zip)** from the
[latest Node SDK release](https://github.com/openai/openai-node/releases/latest)
and extract it. From that directory:

```sh
cd examples
npm install --no-save openai@latest playwright@1.63.0
npx playwright install chromium
```

Keep this shell in `examples/` for all commands below. The examples import the
installed SDK; no source build or symlink is needed. The task browser has a fresh
temporary profile and never uses your signed-in browser.

For SDK development, follow the repository's CONTRIBUTING instructions and
use its pinned pnpm workflow. Keep `examples/package.json` unchanged.

To enable Isolated desktop or Mixed, first build a guest on an Apple-silicon Mac by
following the [desktop setup](../computer-desktop/README.md#setup-and-no-key-exercise).
The runtime is a trusted private path supplied by the server operator. It must
never come from the dashboard, a model, or page content.

## Run

Choose model IDs available to your project through the environment. Keep the API key on the server:

```sh
export OPENAI_API_KEY="<your API key>"
export OPENAI_DECISIONS_MODEL="<your Decisions model>"
export OPENAI_RESPONSES_MODEL="<your Responses model>"
npm install --no-save openai@latest playwright@1.63.0 pngjs@7.0.0
node browser-use-demo/server.mjs --desktop-runtime /private/tmp/desktop-$UID
```

Omit `--desktop-runtime` to run Browser only. Desktop and Mixed are available
only when the server has a runtime path, API key, and Responses model.
Selecting either fixes the API and run mode to **Responses** and **Live API**.
It never substitutes a local rehearsal for a failed live call.

You can instead pass `--key-file /path/to/key` for a regular file owned by you with mode `0600`. `OPENAI_MODEL` can supply either model when the corresponding API-specific variable is absent. The key needs permission to write to the selected API.

Open the private link printed in your terminal. Choose the workspace and select **Start task**.
For Browser, choose the task, API and run mode first. In Isolated desktop,
route D-2201 in the guest browser on the left and save the fixed receipt in
the editor on the right. A desktop phase asks once before its first input
and separately for pending API safety checks. A **Verified** result requires
the guest's independent browser and saved-file checks.

In **Mixed**, use **Host browser / Guest editor** to choose the displayed
workspace. Both images are actual private pixels. Switching views invalidates
the prior image and its controls. The host accepts a human click only on the
original Route D-2201 button. The guest accepts left clicks in the editor half.
After the receipt has been approved and disclosed, it also accepts exactly
`Desktop receipt D-2201` and Ctrl+A or Ctrl+S. It never accepts scroll, another
tab, a file chooser, guest browser input, or arbitrary text. If you Take before
receipt approval, Return to let the agent ask for consent.

Select **Take control** to work in the current private workspace. The display
shows **Waiting for the agent to finish** while admitted work settles.
Only after handoff and a current frame can you click the live image, type
text, send a listed key, or scroll. The green border marks the interactive
view. On Desktop, first click inside the pane you want to scroll. Scroll is
disabled until there is a click for the current human-control phase.

In Browser, select **Open task notes** to open a second browser tab. Its Brief and Rules pages show the instructions for the same task. Click their links in the live image, then use **Workspace tab** to switch between Notes and Task. You can edit the Task form and return to the agent while viewing Notes. The agent receives that actual page and must switch back to Task before acting there. Close Notes to return to Task. Only the original Task tab can submit and verify task results; Notes cannot submit a second copy. Notes and browser tab controls are unavailable on Desktop.

Choose **Return to agent** to resume. The server finishes admitted human
input and observes the current workspace before returning control. Desktop
starts a new conversation from current guest pixels and its independent
check. It keeps the run's remaining request budget; human handoff does not
reset the limit. Old pending calls are never replayed. If the task is already
complete, the check can end the run without another request.

Mixed keeps one 20-request allowance across all phases. Each new phase sends
fresh host state, a fresh guest screenshot, and the checked Route and transfer
facts. Once authorized, the fixed receipt can be included again without a
second GET. An unused grant still expires after 30 seconds; Take cannot renew
it. If a transfer finishes during Take, Return asks for disclosure consent
before sending the verified text. A missing original control, expired unused
grant or unknown effect closes the task as unverified.

Before publishing a verified Desktop or Mixed result, the demo stops the guest
browser and editor, drains their fixture writes, and checks the saved records
again. The completed view is a saved frame. Start a new task to make changes.
A change before sealing can still make the final result unverified; that task
has ended too.

**Stop** remains available during agent control, human control and transfer.
If the demo cannot stop pending browser or desktop work safely, it closes that
workspace. Manual control stays unavailable. Wait for cleanup to finish, then
start a new task. The result stays unverified and may be uncertain. The task
selectors stay locked while the session closes.

Human input requires the current private session and a fresh live frame. A lost connection or unavailable image disables the controls. Open the new private link after a server restart; the example never retries a control request.

Without credentials, select **Local rehearsal · Decisions, no API**. This explicitly selects Decisions and runs scripted choices through the real helper and browser. It reports zero API requests and measures no model quality or live API performance. Selecting Responses returns the controls to **Live API**, which requires a key and a model. A live API error remains visible; the example does not substitute rehearsal or another API.

Responses uses streaming by default. The timeline shows when the stream starts receiving. Browser actions and approval prompts still wait for the complete response; this demo does not enable eager execution. A partial, broken or cancelled stream cannot start an action. Take control or Stop while a stream is open follows the same ownership drain as any other request. Decisions and local rehearsal continue to use finite replies.

## Inspect usage and failures

Open **Usage and diagnostics** in the dashboard. Token counts come from actual
SDK responses. A failed or incomplete request may have no usage; the summary
shows how many attempts are missing instead of estimating them. API time,
measured browser action time and operator approval wait appear separately.
An unavailable duration stays unrecorded. These values do not establish a
speed or cost advantage over another API.

The normal JSON export keeps only fixed status fields, numeric usage and timing.
It omits page text, action arguments, screenshots, raw errors and private file paths.

For a local investigation on macOS or Linux, start the server with
`--diagnostics`. Open **Usage and diagnostics → Open saved trace viewer**.
Choose a run and select an event in its timeline. Saved frames show the actual
isolated browser or desktop at a checkpoint. This separate viewer has no live
input or approval controls.

```sh
node browser-use-demo/server.mjs --diagnostics
```

The server prints a private directory and its capture ID. To view the same
recordings after restarting, pass that exact ID (not the path):

```sh
node browser-use-demo/server.mjs --diagnostics-reopen openai-browser-diagnostics-REPLACE_WITH_PRINTED_ID
```

This choice opens only that demo-owned capture. The viewer also reads older
text-only recordings and reports "No saved frames." It reports incomplete
recordings and omitted events or images, rather than filling in missing data.
A resumed capture can record more runs up to the same total limit.

Captures use a 0700 directory and 0600 files. They retain text observations,
Decisions choices, action results, verification and SDK events. They never
record API headers. Images come only from the owned synthetic workspace at an
actual checkpoint. At most 12 frames are saved per run, 1 MiB per frame, and
8 MiB of images per run; a frame beyond those limits is omitted. Text is
limited to 1 MiB per run. The capture accepts at most 16 runs, for a maximum
of 144 MiB across text and images. This first-frames policy keeps earlier
evidence even when later frames must be omitted. No capture content or file
path appears in a normal JSON export.

Captures remain private files on your computer until you delete that directory.
Inspect any synthetic page values before sharing. To check capture and redaction
without a browser or key, run `node browser-use-demo/exercise-diagnostics.mjs`.

## Inspect a tool manually

1. Start a browser task, such as **Review an invoice queue**, in local rehearsal.
2. When the agent requests approval, choose **Take control**. Wait for the human
   controls to appear.
3. Open **Manual browser tool inspector** and select **Load current tools**.
4. Select `browser_read_page`, consent to this one call, and run it. Inspect the
   result for current element references.
5. Choose a tool and fill its generated fields. Consent again to each call.
   A sensitive action still shows the normal Approve or Refuse card. Stop ends
   pending calls and revokes further input.
6. Choose **Return control** when you want the agent to continue.

Manual calls pass through the same SDK toolset, task validation and current
reference checks as agent calls. They work only on the current owned browser
page after takeover. Stale, refused and stopped requests cannot authorize
later work. File-intake and desktop tasks keep their existing manual controls;
this browser inspector does not bypass those task restrictions. Saved
checkpoints and the saved trace viewer never accept tool input.

## Check the first task

To exercise the tasks, approval refusal, stop, stale consent, and server access checks without a key:

```sh
node browser-use-demo/exercise.mjs
```

Expected output includes `"success": true`, three verified rehearsal tasks, and passing control checks.

## Maintainer regression checks

These checks target separate failure cases. You do not need to run all of them to try or adapt the example.

To check stock shipments, inventory changes, refusal, Stop, and stale controls:

```sh
node browser-use-demo/exercise-stock.mjs
```

This runs six groups of checks in Chromium without an API key. It also checks that page changes and unapproved requests cannot alter inventory.

To check that page text cannot grant shipment approval, and that completed stock
progress survives Take and Return:

```sh
OPENAI_MODEL='<synthetic test ID>' node browser-use-demo/exercise-stock-boundaries.mjs
```

Both cases show the same synthetic dispatch note. The exercise uses real local
Chromium and host inventory, with scripted API replies and no external calls.
It checks an explicit refusal and a correct shipment on each side of Take and
Return, under the original request limit. This does not measure how a real model
responds to untrusted instructions.

To check the service form and its saved record:

```sh
OPENAI_MODEL='<synthetic test ID>' node browser-use-demo/exercise-service.mjs
```

The service exercise uses real local Chromium and scripted API replies. It checks saved values, incorrect approved values, refusal, Stop, copied fields and a replaced control.

To check file opt-in, approval, native selection, loopback receipt, Stop and expiry:

```sh
OPENAI_MODEL='<synthetic test ID>' node --expose-gc browser-use-demo/exercise-files.mjs
```

The file exercise checks real local selection and receipt separately, including wrong bytes, duplicate requests and Stop during setup. The GC option also checks that a pending permit survives garbage collection on Node 22. Both exercises use the supplied ID only for the configuration check, block outbound API calls, and require no API key.

To check frame changes without SDK actions and cleanup on page close:

```sh
node browser-use-demo/exercise-view.mjs
```

This uses Playwright's public screencast API and an animated synthetic page. It makes no API request.

To check connection failures, slow bodies, and stale replies in the actual dashboard script:

```sh
node browser-use-demo/exercise-dashboard.mjs
```

This controls request completion order with a minimal DOM. It tests UI races without claiming a browser or live API run.

For mixed Take/Return, use the controlled and native checks separately:

```sh
node responses/browser/exercise-mixed-handoff.mjs
node browser-use-demo/exercise-mixed.mjs --runtime-dir /private/tmp/desktop-$UID
```

The first uses real task-owned Chromium and loopback HTTP with a simulated
desktop. It checks held approvals and human input, fresh observations, an
unknown transfer, and the shared request budget. The second uses a real guest
and Fieldwork at desktop and phone sizes with synthetic API replies. It checks
the fixed host Route, receipt approval, real editor save, stale controls,
fresh Return, export and exact guest cleanup. Neither makes live API calls.

For the private desktop phase ledger, session and startup/shutdown boundaries:

```sh
node browser-use-demo/exercise-desktop-ledger.mjs
node browser-use-demo/exercise-desktop-session.mjs
node browser-use-demo/exercise-desktop-startup.mjs
node browser-use-demo/exercise-desktop-shutdown.mjs
```

These are controlled local checks. They cover owned checkpoint writes,
unfinished startup, held work during shutdown and cleanup failure. The
shutdown exercise also waits through the 35-second deadline. These checks
do not establish native guest or live API behavior.

To exercise the dashboard with an actual guest and synthetic API replies:

```sh
node browser-use-demo/exercise-desktop.mjs --runtime-dir /private/tmp/desktop-$UID
```

This exercise requires the built guest and Playwright from Setup. It uses
its own dummy key and local API replies; it does not call the live API.
Run it separately from the controlled checks. Passing an individual guest
or ledger check is not evidence that this complete dashboard exercise passed.

To test Responses refusal and cancellation with actual Chromium and mock API responses, supply a
synthetic test ID as `OPENAI_MODEL` (any nonempty identifier you use only for this exercise):

```sh
OPENAI_MODEL="<synthetic test ID>" node browser-use-demo/exercise-responses.mjs
```

This exercise supplies its own dummy key. It never reads an API key and blocks every outbound Node
request except loopback dashboard access and the Responses endpoint that it intercepts locally.
Expected output includes `"success": true`, `"kind": "mock Responses, real Chromium; not live API"`,
a refusal after two mock requests, a stopped fetch counted once, and incomplete or broken streams that cannot act.
It proves browser/control behavior, not model performance or live API access.

## Execution and policy

The server binds to loopback and validates its fixed Host and Origin. Only the trusted launcher supplies the control token in a URL fragment. Control requests use a session token in a header. Approval and input require the current run, owner and browser page. Before a tab exists, only Take may use the initial empty page binding. The browser allows the Task, Brief and Rules URLs installed for this task. Stock, service and file tasks each permit one additional fixed endpoint for that run. The context blocks external requests, control routes, WebSockets, service workers, and downloads. Chromium receives a minimal environment without the SDK key.

Decisions receives current text and an inline screenshot, then chooses from caller-supplied operations. On Notes it can switch to Task before preparing fresh choices. It cannot generate arbitrary tool arguments. Responses uses `BrowserToolset` and `ResponsesToolRunner` to operate the same interface. The demo requires a selected active tab for reads and actions; only `switch_tab` accepts another known tab. Candidate executors and browser operations check current URL, tab and task revision, and recheck after awaiting approval. The caller owns these checks and the browser's lifetime.

When a run ends, **Export run JSON** requests a fixed server-side projection.
It contains version and run ID, Browser/Desktop/Mixed and task choice, API/mode,
status, owner, verified/unverified result, uncertainty and cleanup status,
request and turn counts, limit, timing, and bounded receipt events.
Events contain only request status and timing, approval outcomes, control
owner, cleanup outcomes, or counts of attempted and returned tools. The file
task may include its bounded status/effect/cleanup states.

Export excludes raw model text and responses, tool arguments and results,
approval text, fixture fields and file content, images, saved-checkpoint
metadata, private ledger history, URLs, paths, credentials, and errors.
It does not copy the displayed timeline or private session object.
`requestHeadersMs` measures time to response headers, excluding body wait,
guest work and approval. `elapsedMs` covers task execution and human waits;
final cleanup is recorded separately in the receipt events. These timings
describe this run only, not general model performance.

Each desktop or mixed agent phase writes its SDK checkpoints to an owned private
directory. That record may contain private request history or pixels, so it
never enters Export. The server removes it only after the entire runner phase
settles; it does not load it to resume after handoff. Shutdown first bounds
VM retirement, then waits up to 35 seconds for the whole run and ledger
cleanup. A timeout or cleanup failure exits nonzero and reports any retained
private path only to the local server terminal. Treat that as incomplete
cleanup, not a successful stop.

This example is a local starter. Real sites need their own driver, network
policy, consent rules and outcome checks.
