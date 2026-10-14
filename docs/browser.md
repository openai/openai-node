# Structured browser tools and mixed Responses runs

Supply a browser driver to expose page structure, text, element refs, forms and tabs as Responses function
tools. The driver owns the browser, the network policy and closing it. It implements `state()` and only
the methods you want to offer. The SDK advertises only those methods and, by default, derives
`list_tabs` from `state()`. There is no browser dependency in the SDK.

## Start with a read-only driver

Install the SDK and Playwright in your own Node.js 22 or later project:

```sh
npm install openai playwright@1.63.0
npx playwright install chromium
```

On Linux, if bundled Chromium cannot start with its sandbox enabled, select
a locally installed Chrome before running the quickstart:

```sh
export OPENAI_EXAMPLE_BROWSER_CHANNEL=chrome
```

Leave the variable unset to use Playwright's bundled Chromium. Both choices
keep the browser sandbox enabled.

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in your shell. Use a model available to your project
that supports Responses function tools. Save this as `reader.mjs`, then run `node reader.mjs`.

```js
import OpenAI from 'openai';
import { chromium } from 'playwright';
import { BrowserError, BrowserToolset } from 'openai/helpers/browser';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';

const model = process.env['OPENAI_MODEL'];
if (!model) throw new Error('Set OPENAI_MODEL to a model that supports Responses function tools.');
const channel = process.env['OPENAI_EXAMPLE_BROWSER_CHANNEL'];
if (channel !== undefined && channel !== 'chrome') {
  throw new Error('OPENAI_EXAMPLE_BROWSER_CHANNEL must be unset or chrome.');
}
const session = await chromium.launch({
  channel,
  chromiumSandbox: true,
  env: { PATH: process.env['PATH'] ?? '' },
});
try {
  const page = await session.newPage();
  await page.setContent('<title>Cafe</title><p>Cafe hours: 08:00-16:00.</p>');
  const driver = {
    async state() {
      return { tabs: [{ id: 'one', title: await page.title(), url: page.url(), active: true }] };
    },
    async get_page_text({ tab_id }) {
      if (tab_id !== null && tab_id !== 'one') throw new BrowserError('Unknown tab.');
      return await page.locator('body').innerText();
    },
  };
  const browser = new BrowserToolset(driver, { members: ['get_page_text'] });
  const response = await new ResponsesToolRunner({ browser }).run(
    new OpenAI(),
    { model, input: 'Read the page and tell me when the cafe closes.', store: false },
    { maxSteps: 3 },
  );
  console.log(response.output_text);
} finally {
  await session.close();
}
```

The answer should say that the cafe closes at 16:00. This example sends the current text from a
real, isolated browser page. The driver rejects unknown tabs; it exposes no writes and needs no
approval callback. Replace the sample page with a page your app controls and grant only the reads
your task needs. Keep the isolated session and its cleanup in your application.

## Driver contract

Create drivers and approval callbacks in trusted application code. Keep executable configuration
separate from untrusted page data, and return page data through the declared driver report fields.
Configuration can use class or null-prototype inheritance. Lookup ignores the local `Object.prototype`
and foreign native base prototypes with intact constructor metadata. Only pass executable options
from JavaScript realms your application trusts.

`confirm` is required when a selected method can change browser state or read diagnostics. Only exactly `true`
authorizes an action. `urlPolicy` is required for `navigate` and `new_tab`. Both callbacks receive
a detached `{member, arguments, state}` object so they cannot change the action that was validated.
Browser policies receive the execution signal as a final argument:
`confirm(context, { signal })` and `urlPolicy(context, url, { signal })`.
This includes `confirm` calls made for `confirmReads`. Existing callbacks can
ignore the extra argument. Interactive approvals can listen for abort and
settle promptly. The toolset remains busy until a running callback settles.
Apply request interception at the browser context too: a direct navigation policy cannot restrict
redirects, popups, page scripts or subresources.

`confirm` approves the fixed action arguments. Its `state` is a prior observation, not a lock
on the document or focused control. A page can navigate or change focus while a person decides.
For consent tied to a specific page or control, the driver must check the original target at execution.
Disable `key` and refuse `type` with a null target in that flow; both use current focus.
Apply equivalent target binding to other actions that depend on the current browser state.

The default methods are `navigate`, `read_page`, `get_page_text`, `find`, `click`, `type`,
`key`, `scroll`, `scroll_to`, `wait_for`, `select_option`, `hover`, `screenshot`, `zoom`,
`new_tab`, `switch_tab`, and `close_tab`. Each takes an object with the corresponding
`BrowserArguments<Member>` type. Every driver method except `state` receives
`{ signal }` as a second argument, including navigation, reads, input, and opt-in methods.
Existing one-argument JavaScript methods can ignore that argument. For prompt Stop behavior,
check the signal before effects and pass it to any I/O that supports cancellation.
`list_tabs` is built from required `state({ signal })`; do not implement it. The state reporter
receives the same signal as other methods for both initial and final observations.
Asynchronous state reads should stop cooperatively when it aborts so `close()` can drain.
Existing state reporters that ignore arguments continue to work. Optional tab IDs or targets in
arguments use `null`. Results include current tab state. Unknown arguments cannot reach the driver.

Tab state reports HTTP and HTTPS origins, such as `https://example.com:8443`, without credentials,
paths, queries, or fragments. Legacy state (without observation metadata) preserves `about:blank`
and reports only the scheme for other URLs, such as `data:` or `file:`. Its 2048-byte UTF-8 limit
applies to the reported value, so a long page path does not prevent a state read.
State with observation metadata accepts only HTTP(S) URLs or `about:blank` and displays HTTP(S) origins.
It truncates titles to 1,024 UTF-8 bytes at a character boundary and sets `title_truncated` when needed.
The SDK does not impose a tab-count limit, with or without observation metadata. Individual
drivers may set their own limits. Titles and page content still need your application's privacy policy.

`scroll_to({target, tab_id})` needs confirmation.
`wait_for({text, timeout_ms, tab_id}, {signal})` is a read. Use a nonempty text condition of at most
256 UTF-8 bytes after whitespace normalization and a timeout from 1 through 30000 milliseconds.
See [navigation and waits](browser-navigation.md) for the cancellation contract and owned example.

Both `screenshot` and `zoom` return a native `input_image` with at least one nonempty
`image_url` or `file_id`. Both may be present; every supplied source must be valid.
Browser image results permit only `type`, `image_url`, `file_id`,
`detail`, and the native optional `prompt_cache_breakpoint: { mode: 'explicit' }`.
The helper validates and copies the breakpoint before reading final state. Both methods return
`ResponseInputImageContent`: `detail` may be omitted or null, or set to `auto`, `low`, `high`, or
`original`. Zoom takes `{tab_id, region: [left, top, right, bottom]}`; the four coordinates must be
nonnegative safe integers with positive width and height. The driver owns cropping and viewport
bounds. Later coordinates still refer to the full viewport. See [pointer tasks](browser-pointer.md).

Set `members: ['read_page', 'get_page_text', 'screenshot']` to expose only selected methods from a
full driver. Names must be unique fixed members implemented by that driver; `list_tabs` needs only
`state()`. An empty list exposes no methods. Selection is copied at construction and tools keep the
SDK's order. Confirmation and URL policy are required only for selected methods. Disabled calls are
rejected before reading state or asking for consent. Omitting `members` preserves the default methods,
including `list_tabs`. Disabling `list_tabs` does not hide state returned by other successful operations. This option filters this toolset, not separately registered ordinary functions.

To add one opt-in method while keeping the defaults your partial driver implements, use
`additionalMembers: ['read_page_scoped']`. An explicit addition must exist on your driver.
Use either `members` or `additionalMembers`, never both. `BROWSER_MEMBERS` and
`DEFAULT_BROWSER_MEMBERS` are read-only lists exported by `openai/helpers/browser`.
They describe the fixed vocabulary, not the capabilities of a particular driver.
`BrowserResult<Member>` gives the result type for a driver method. In a `confirm` callback,
`context.member` narrows `context.arguments`; `context.call_id` identifies the original call.

To ask before a sensitive read, set `confirmReads: ['get_page_text', 'screenshot', 'list_tabs']`.
The same `confirm` callback then receives a `phase: 'before_read'` record whose `state` is null.
No browser state has been read at that point; decide using your own policy and the supplied tab ID.
A refusal returns no tab state, page content or image. Existing required action approvals still apply.

Browser, computer, and runner helpers each accept one active operation. An overlapping operation
fails with a busy error. `close()` stops new admission and returns `{status:'closed'}` or
`{status:'draining'}`. If draining, await the current execute or run before you release the
driver. Helpers never close your driver. Cooperative driver methods can use the supplied signal;
Stop waits for a noncooperative operation to return and never retries it.

## Opt in to scoped reads and pointer input

These four fixed members are off by default, even when a driver implements them.
List each one explicitly in `members` to expose it. The original 18 defaults, including
derived `list_tabs`, keep their existing arguments and behavior. An explicit selection must
also include any default methods you still need. For example, a scoped reader can select
`members: ['read_page', 'read_page_scoped']`; a pointer driver can select
`members: ['screenshot', 'click_at', 'drag_path', 'hold_keys']` and must supply `confirm`.

| Method             | `BrowserArguments<Member>` fields                   | Result                |
| ------------------ | --------------------------------------------------- | --------------------- |
| `click_at`         | `tab_id`, `x`, `y`, `button`, `click_count`, `keys` | string or void        |
| `drag_path`        | `tab_id`, `path`, `keys`                            | string or void        |
| `hold_keys`        | `tab_id`, `keys`, `duration_ms`                     | string or void        |
| `read_page_scoped` | `tab_id`, `root`, `depth`, `filter`                 | `BrowserScopedReadV1` |

Two additional opt-ins support precise pointer and checkbox actions:
`hover_at` takes `{tab_id, x, y}` in full-viewport CSS coordinates.
`set_checked` takes `{tab_id, target, checked}`, where checked is a Boolean.
Both require confirmation. Drivers must validate current bounds and original refs; setting the
same checkbox value twice must not toggle it back. Neither action holds input across calls.

All fields are required, with `tab_id: null` meaning the active tab. Unknown properties
are rejected, including extra properties on a path point. Coordinates are nonnegative safe
integers in the full CSS viewport. They still use the full viewport after a zoom; the driver
must check current bounds. For `click_at`, `button` is `left`, `right`, or `middle`, and
`click_count` is 1, 2, or 3. For `drag_path`, `path` contains 2 through 100 exact
`{x, y}` points. The `keys` on those two methods contain unique `Control`, `Alt`, `Meta`,
or `Shift` modifiers; an empty array is allowed.

`hold_keys` takes 1 through 8 unique nonempty key names of at most 64 UTF-8 bytes each,
with valid Unicode scalar values, and `duration_ms` from 1 through 3000. All numbers must
be finite safe integers. The three mutators require `confirm` returning exactly `true`
before execution. Each receives the same `{ signal }` options as other browser methods.

`read_page_scoped` is a read and needs no confirmation. A null `root` discovers visible
sections; a non-null root is a driver-issued scope ref, never a selector. It must be nonempty,
at most 256 UTF-8 bytes, and valid Unicode. `depth` is from 1 through 32; `filter` is
`all` or `interactive`. DOM depth within the root is separate from frame and shadow limits.

Return `BrowserScopedReadV1`, exported from `openai/helpers/browser`. It has the existing
`version`, `text`, `elements`, and `omitted` fields plus `scopes: [{ref, label}]`.
The array has at most 100 entries. Each ref and label must be nonempty, valid Unicode, and
at most 256 UTF-8 bytes. Scope refs must be unique and must not equal any element ref.
The SDK does not cap page text or total report bytes.
String, null, and undefined results are rejected for this method. The SDK copies approved
fields before the final state callback. Original `BrowserReadV1` reports and their seven
action roles are unchanged.

Scope refs can select a read root, but they cannot authorize an element mutation. Invalidate
them with the same tab, document, generation and visibility changes as element refs. Element
actions must reject scope refs. Keep field privacy and work limits in the driver.

## Opt in to diagnostics, scripts, and file transfers

These four methods also stay off by default. Select each one in `members` and
provide `confirm`, including for diagnostic reads. A driver's implementation alone
does not expose them to the model.

| Method             | Required arguments               | Result               |
| ------------------ | -------------------------------- | -------------------- |
| `read_diagnostics` | `tab_id`, `source`, `limit`      | `BrowserTextReadV1`  |
| `run_script`       | `tab_id`, `source`, `timeout_ms` | Text                 |
| `upload_file`      | `grant_id`                       | `BrowserFileOutcome` |
| `download_file`    | `grant_id`                       | `BrowserFileOutcome` |

For `read_diagnostics`, choose `console` or `network` as the source and a limit
from 1 through 100. Return a structured read with an empty `elements` array.
The driver must filter private data and bound its history. Do not return raw
headers, cookies, credentials, or unfiltered console messages.

`run_script` takes nonempty source containing valid Unicode and a timeout
from 1 through 30000 milliseconds. The SDK preserves the full source.
Return text containing valid Unicode.
An empty string is valid; a null result is not. The SDK preserves large results.
Scripts run with the page's privileges. Use a fresh session without
credentials, restrict its network access, and retire it if execution becomes
uncertain. Stopping the local waiter does not prove that a page script stopped.

File methods accept only a caller-issued `grant_id`: nonempty, valid Unicode,
and at most 256 UTF-8 bytes. The grant identifies one approved, task-scoped file;
it is not a path or URL. The file owner must get separate file approval. It must recheck expiry and
ownership, enforce size limits, and permit the grant only once. Browser confirmation does not replace this file approval.

Return exactly `version`, `status`, `effect`, and `cleanup`. Set `version` to 1.
`cleanup` is `not_started`, `pending`, or `completed`. The valid status/effect
pairs are:

| `status`      | `effect`            |
| ------------- | ------------------- |
| `completed`   | `completed`         |
| `refused`     | `none`              |
| `unknown`     | `unknown`           |
| `interrupted` | `none` or `unknown` |

The SDK copies and validates this result before asking for final browser state.
Only `completed` sets the tool output's `ok` to true. Other outcomes retain the
structured result with `ok` false, so the runner skips dependent browser calls in
that response. Check the actual file and application state before retrying an
unknown transfer. A file result does not prove that a later form submission or
business action succeeded.

`run_script`, `upload_file`, `download_file`, and diagnostic reads receive
the same `{ signal }` options as other browser methods. Applications own file
staging, grants and cleanup; the booking example does not implement these methods.

## Return a structured page read

The `read_page`, `find` and `get_page_text` methods may return a `BrowserReadV1` object:

```ts
import type { BrowserReadV1 } from 'openai/helpers/browser';

const read: BrowserReadV1 = {
  version: 1,
  text: 'Dispatch queue',
  elements: [{ ref: 'current-button', role: 'button', label: 'Dispatch BP-1207' }],
  omitted: ['value'],
};
```

Each element has a unique `ref`, a nonempty label, and one of these roles: `button`, `textbox`,
`combobox`, `checkbox`, `radio`, `slider`, or `listbox`.
Optional `value` and `options: [{label, value}]` contain only data the driver permits the model to see.
Checkbox and radio elements may report Boolean `checked`; listbox options may report Boolean
`selected`. The SDK omits those fields on other roles.
The SDK omits optional fields set to `undefined`; it rejects `null` values for those fields.
`get_page_text` must return an empty `elements` array. The SDK does not parse strings as structured
reads. A `null` result or an omitted return supplies only the updated browser state. Return an empty
string when the read completes with no text.

The SDK copies known fields before reading final state. It rejects invalid reports and stops the run.
Unknown fields are omitted without being read. Refs and labels have a
256-byte limit; values have a 512-byte limit. The SDK does not limit the
number of elements or options.
Page text and the complete report have no SDK byte limit. Text must contain valid Unicode scalar values. Omission
codes must be unique members of `BrowserReadV1['omitted']`; use them to report incomplete coverage.

The driver owns visibility, field privacy and ref validity. Size checks do not
make arbitrary page data safe. Limit driver work to the document and fields
your application permits, and report incomplete coverage in `omitted`.
Fieldwork implements only its own fixed reservation page; it does not claim
general browsing, arbitrary DOM filtering, or frame and shadow-root support.

Throw `BrowserError` with text safe for the model when the driver detects a recoverable problem such
as a stale element ref. Other errors become a generic failure message. The runner returns a matching
output for every browser call, skips remaining browser operations in that response after a refusal or
failure, and allows the model to replan on the next turn. If browser state cannot be reported, the run stops.

Pass `computer: new ComputerToolset(driver)` alongside the browser and functions to use native computer
actions. `computerOptions` forwards existing safety and action approval callbacks. Unapproved native
computer checks and failed ordinary functions stop the run. `params.tools` may include one native
computer declaration for that driver and server-side `web_search`, its preview aliases,
`file_search`, `code_interpreter`, `image_generation`, or `mcp`. Register other
client functions in `functions`, using their generated `FunctionTool` definition and an executor that
accepts a decoded object and returns text or native function output content.

For MCP, set `approveMcp(request)` in run options. The runner waits for a completed response,
then passes the actual approval request. Return exactly `true` or `false`; missing or invalid
approval stops the run. Only explicitly declared MCP server labels are admitted. Failed server calls
stop before pending local effects. A ledger retains that failed response as a non-resumable proposal.
When an MCP tool is admitted, the ledger also saves a pending checkpoint before each request.
Requests that declare MCP tools disable automatic SDK retries, with or without a ledger.
If transport fails or the response is lost, inspect the MCP server before starting a new run;
that checkpoint cannot resume, since the server may already have applied an effect.
Saved MCP declarations omit authorization and custom headers and replace server URLs with SHA-256
fingerprints. Native requests still use the original URL. Put credentials that must rotate in
authorization or headers. Changing a URL path or an unrecognized query value changes its identity
and requires a new run. Checkpoints containing raw MCP URLs cannot resume. Node requires `crypto.subtle.digest`
to save an MCP URL. Other checkpoint inputs and outputs remain private application data.
Saved Code Interpreter declarations keep credential names and domains but clear
their secret values. Supply current values in the tool configuration when resuming.
The runner does not execute client-side discovery, shell, patch or custom tools.

Supply `approveMcp` when initial input or a saved ledger contains approved MCP requests.
Before the first save or API request, the runner asks again for each approval that has no completed
matching MCP call. This applies with or without a ledger or context budget. It keeps completed calls
and earlier refusals unchanged. If fresh approval is needed, a missing callback stops the run.

Approval is required by default. The runner enforces `always`, `never`, and unambiguous
tool-name approval filters from the captured request. A call that requires approval must
reference a matching prior approved request before local work can continue.
An empty `always: {}` or `never: {}` filter applies to every tool. Read-only
filters and ambiguous filter combinations remain API policies because the response does
not contain enough information to verify them.

Use a trusted OpenAI client. Custom client hooks and transports can change requests
and retry behavior after the helper validates its inputs; your application owns those changes.
For Responses and Decisions runs, a fixed caller-supplied idempotency key applies to the first request. Later turns get fresh keys; HTTP retries of one request retain its key.
Each continuation captures headers and the idempotency key together, even when no key is present. Other native request options remain live until dispatch.
Supply trusted per-run `requestOptions` too. Without a ledger, native request options
can change the request body, path, base URL, or fetch settings after validation.
Ledger runs accept a narrower set of options.

If you already use `zodResponsesFunction` or `standardResponsesFunction`, pass it through
`runnerFunction` from `openai/helpers/responses-tool-runner`:

```ts
const runner = new ResponsesToolRunner({
  browser,
  functions: [runnerFunction(existingTypedTool)],
});
```

The typed tool must have a callback. Its parser validates arguments before the callback runs.
The callback returns text or native text, image, or file content blocks. Other return values stop
the run without replaying the effect. A parse-only tool fails at registration.

The runner preserves `tool_choice` for every request. It rejects a choice that
always requires a local tool because that run cannot finish. This includes a
specific function or computer choice, `required` when all declared tools are
local, and `allowed_tools` with `mode: 'required'` when every allowed tool is
local. Use `auto`, or use `responses.create` for a single forced request.
Required choices that also permit a declared server tool remain supported.

By default the runner sends non-streaming requests. Set `{stream:true,onEvent}` to receive detached
stream events. Execution still waits until the response completes. The optional `eager:true` setting
dispatches only completed output items, in their output order, before the response finishes. It never
executes argument deltas. An interrupted eager stream may have already changed the environment.
Enable eager execution only when a completed item may run before the runner validates the full response. If
a later event changes or removes that item, the runner stops and keeps its execution record. It
cannot undo the action. Leave eager execution off, or use an empty policy for early execution, if all
actions must wait for the complete response to pass validation.
For sparse or out-of-order stream indices, the runner defers the suffix after
the first gap until the completed response confirms the output order. Already
executed prefix calls retain their receipts if the stream fails.
`ResponsesToolRunnerError.attemptedCallIds` and `completedCallIds` report the calls that ran; they
never contain arguments, results or driver exception messages. Inspect the environment before retrying.
The error message identifies fixed SDK validation failures, such as an incomplete
response or mismatched stream output. Errors from API calls, drivers, parsers and
checkpoint storage keep a generic message.
`signal` cancels between operations. `maxSteps` bounds API requests (default 20) and forbids new
effects on the final allowed request. SDK request retries do not retry driver actions.

Set `onDiagnostic(event)` on a Responses or Decisions run for local stage timings and reason
codes. Records contain `api`, `stage`, `reason`, `call_id`, `member`, `duration_ms`, and
actual numeric `usage` or null. They omit raw arguments, images and error text. Call IDs and
member names can still contain application data; inspect them before sharing. Broken observers
cannot authorize actions or change execution. Stream request duration measures time until receipt;
in eager mode it may include time spent awaiting actions, so do not add those durations together.

## Choose which tools can run early

Set `earlyExecution` when constructing the runner to limit execution before full response inspection:

```ts
const runner = new ResponsesToolRunner({
  browser,
  functions: [{ tool: recordDeclaration, execute: record }],
  earlyExecution: { functions: ['browser_get_page_text'], computer: false },
});
const response = await runner.run(client, params, { stream: true, eager: true });
```

Use registered function wire names, including exposed `browser_` names. The separate `computer`
Boolean selects the native computer dispatcher; an ordinary function named `computer` remains a
function. Unknown or duplicate names and invalid policies fail at construction. The runner copies
the selection, so later caller mutations do not change it.

The policy applies only with both `stream` and `eager` enabled. Omitting it or passing null keeps
blanket eager execution. An empty object defers every local tool. The first deferred tool holds
all later items in their original order, including tools selected for early execution.
`run()` advances automatically. With `iterate()`, inspect the completed turn before advancing.
Closing the iterator at that boundary executes no deferred tools and sends no next request.

When you declare a server tool, including MCP, the runner waits for the whole response before it runs local tools. A failed or incomplete server call can invalidate later local work. At that boundary, `supplyOutputs` can replace an unattempted ordinary function that allows overrides, even without an explicit early-execution policy. Independent early execution is available in runs that contain local tools only.

This runner needs stored responses to continue after image generation.
The runner rejects `store: false` with `image_generation` before sending a request or running a function.
Set `store: true` when storage is appropriate, or use `client.responses.create` for a single stateless request.
The runner never enables storage for you.

For one sensitive instance of an otherwise permitted call, set `beforeEarlyCall(call)` in run
options and return `'defer'`; return `'execute'` to keep its existing permission. The callback
cannot expand `earlyExecution`. Deferred effects wait until you advance the completed turn.
Remote MCP approval always waits for that boundary.

Set `independent: true` only on an ordinary registered function that does not depend on other
calls. In an eager run without a ledger, it can finish while stream events continue. The runner
admits at most two independent calls at a time by default. Set `maxConcurrentCalls` in
the run options to another positive safe integer. At each full window the runner waits
for every admitted call, saves their outputs in original order, and only then reads
more stream events. A limit of 1 keeps these calls sequential.
The limit applies only to opted-in independent eager calls without a ledger. The runner
waits for all preceding independent work before any dependent browser, computer or function effect,
and before reporting the turn. A failure stops dependent work and retains attempted IDs. Ledger
runs keep execution ordered so durable revisions cannot race. No speed improvement is promised.

The policy changes timing, not permission. Browser confirmation and native safety/action checks still
run before each effect. Earlier effects can survive a later refusal or stream failure. Supplied outputs
can replace only unattempted ordinary functions that explicitly allow overrides, never browser or
native computer calls. A saved proposal with deferred work is not a resumable completed boundary.

## Bound the next request's history

ResponsesToolRunner accepts an optional `contextBudget` on `run()` or `iterate()`.
The budget works with or without a ledger. An ordinary run keeps full history in memory while
projecting each request to the limits. A ledger additionally saves recovery evidence and enforces
its stricter admission and resume rules. Neither mode restores its request budget after compaction.
Even when the next request omits old results, attempted call IDs remain tracked.

At a non-final `iterate()` turn, call `turn.appendUserText('Please check the invoice date too.')`.
The runner adds this as user text only after the pending tool outputs. It cannot supply a tool result
or grant approval. Final and expired turns reject new text. Ledger runs save the appended text with
the completed boundary; they still require fresh observations when resumed.

```ts
const response = await runner.run(client, params, {
  ledger: {
    runId: taskId,
    save: async (checkpoint) => storeUnderExclusiveOwnership(taskId, checkpoint),
  },
  contextBudget: {
    maxInputBytes: 128 * 1024,
    maxInputImages: 2,
    keepRecentScreenshots: 1,
    compact({ eligibleCallIds }) {
      return { dropCallIds: eligibleCallIds, summary: 'Continue from the latest observations.' };
    },
  },
});
```

The byte bound measures compact UTF-8 JSON for the native `input` array. The image bound counts
native message/function images and computer screenshots, whether inline, URL-based, or file-backed.
File contents behind a URL or ID are not fetched. These are local input limits, not model-token,
whole-request, ledger-storage, time or cost limits.

Every save receives a detached, complete checkpoint, including saves before and after local
effects. The application owns the storage limit and retention policy for those checkpoints.
Large batches or long histories
can produce quadratic cumulative copying and storage work as each snapshot grows.
`contextBudget` limits the next API input; it does not bound ledger storage or that snapshot work.

An interrupted pending checkpoint contains the last saved prefix. It can omit later text and unattempted proposals; it never authorizes replay. Before and after an effect, the saved checkpoint includes the full observed prefix and execution records.

The callback runs after ledger validation, only when the next input exceeds a limit.
The request has not been counted or saved yet. The callback can select complete eligible call/output pairs. The SDK pins
the latest browser and computer observations, recent screenshots (at least one, default one),
explicit computer safety checks, all messages and reasoning. Callback changes to its snapshot
cannot alter replay. For each selected pair, the request receives an SDK-authored call-ID/tool
receipt that says the external effect is unverified. The optional caller summary is a separate
ordinary user message; it cannot grant approval or replace a pending tool result.

If no callback is supplied, its decision is invalid, or the pinned input plus receipts still exceeds
the limit, the runner stops before another request or effect. It never silently drops history.
The ledger retains its original 14 fields and all outputs; its saved request count and `maxSteps`
survive resume. Supply the context policy again on resume; omission or null preserves normal full
history replay. Budgeted runs reject `truncation: 'auto'` and automatic `context_management`.
The bounds apply per invocation, not permanently to future resumes.

Without `contextBudget`, the runner also accepts native Responses `context_management`
compaction. It checks the required item fields and replays the encrypted content unchanged,
including when resuming a saved run. Do not combine the two modes.

Callbacks can return a promise. Use `signal` for a persistent stop request. The runner awaits a
callback that ignores cancellation, then checks the signal and sends no further request. It cannot
undo arbitrary caller callback effects. Iterator close never invokes compaction to finalize pending
work; approvals and the selective early-execution barrier still apply.

## Select actions with Decisions

Use `DecisionsToolRunner` when your application can supply a finite set of possible actions and all
their arguments. Decisions chooses one ID; it does not generate browser actions or text to type.
The runner uses current text or inline-image observations and sends one choice question per request.

Each request receives only the observation you supply. Include earlier page content needed for
the choice, such as rules read in another tab. Bound that saved text and keep it separate from
current element references. Refresh references before executing an action.

For a task with several steps, include the last completed action and bounded page text from before it.
Capture that text from the same validated read used to create the action. Save it only after the
tool reports success, and reset it for a new task. Keep browser handles inside the executor and
use separate choice IDs. If a tool refuses or fails, stop the executor with an error.

```ts
import OpenAI from 'openai';
import { DecisionsToolRunner } from 'openai/helpers/decisions-tool-runner';

const model = process.env['OPENAI_MODEL'];
if (!model) throw new Error('Set OPENAI_MODEL for Decisions.');
const runner = new DecisionsToolRunner({
  observe: async () => [
    { type: 'input_text', text: await driver.visibleText() },
    { type: 'input_image', image_url: await driver.inlineScreenshot() },
  ],
  candidates: async (observation) => {
    const allowed = await allowedOperations(observation);
    return [
      { id: 'finished', description: 'The task is complete.', done: true },
      ...allowed.map((operation) => ({
        id: operation.id,
        description: operation.description,
        execute: () => operation.confirmAndExecute(),
      })),
    ];
  },
  verify: async () => await driver.checkActualOutcome(),
});
const result = await runner.run(new OpenAI(), { model, input: task }, { maxSteps: 20 });
if (result.status === 'verified') {
  // The application's verify callback returned true after reading current state.
}
```

Every turn needs one `done:true` candidate with no executor. Other candidates need a unique, nonempty
string ID, a description, and an executor. Up to 255 candidates are allowed. A done-only list makes
no API request: the runner verifies the current state locally. If that verification fails, it stops
immediately. With multiple choices, failed verification reads new state and tries again within
`maxSteps`. Zero candidates are invalid.

`result.status` is `verified` only when your verifier returns exactly `true`.
Without a verifier, selecting done returns `unverified`. API refusal returns `refused`.
`result.decisions` contains the actual API results and their usage. It contains no invented response
IDs or tool calls. `attemptedCandidateIds` and `completedCandidateIds` identify operations
that started and finished, and can repeat across requests. A `DecisionsToolRunnerError` includes the
same ID lists and a fixed `reason`; it excludes driver messages, action arguments and screenshots.
Inspect the environment before retrying any run that may have made partial changes.

The application owns the driver, candidate executors and their action policy. Confirm or reject
operations in the executor, recheck URL and state before a mutation, and apply a context-level network
guard for redirects, popups and subresources. Do not treat a model choice or its confidence as approval.
The SDK cannot apply BrowserToolset's policies to an arbitrary callback. Decisions supports text and
inline `data:image/...` observations; external image URLs, tool history and files are unsupported.
It requires API access for the caller's project and selected model.

`maxSteps` bounds Decisions requests and prevents any execution on the final allowed request.
`signal` or `requestOptions.signal` cancels between observations, requests and actions. Streaming,
eager execution, Responses history and unrecognized parameters are rejected before any action.
The allowed `requestOptions` are `headers`, `timeout`, `maxRetries` and `signal`; the runner
owns the request body and route. It copies these settings before invoking any callbacks.
Use `ResponsesToolRunner` above when the model should generate actions, and for Responses streaming.

## Try the optional Playwright example

### Choose a local browser

The local Browser examples use Playwright's bundled Chromium by default.
On Linux, when bundled Chromium cannot start with the host's sandbox, install
Google Chrome through your system's approved package setup. Then set:

```sh
export OPENAI_EXAMPLE_BROWSER_CHANNEL=chrome
```

This selects installed Chrome for the local reader and Fieldwork. Both use a fresh profile with the browser sandbox enabled. The setting accepts only `chrome`; unset it to use bundled Chromium.

Download the release source matching your installed SDK and follow the
[Fieldwork setup](../examples/browser-use-demo/README.md#setup) or the
[read-only reader](../examples/responses/browser/README-read-only.md).
No Playwright installation is needed to import the SDK itself.

## Hosted environments

See [provider connections](browser-providers.md) for the browser and desktop
driver contracts and application ownership.
