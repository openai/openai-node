# Computer tools

Use `ComputerToolset` with a driver for an isolated browser or virtual computer.
The driver owns the environment. The helper handles computer calls, approvals,
ordered actions, screenshots, and continuation through the Responses API.

```ts
import OpenAI, { ComputerToolset } from 'openai';
import type { ComputerDriver } from 'openai';

declare const driver: ComputerDriver; // Your browser or virtual computer adapter.
const client = new OpenAI();
const tools = new ComputerToolset(driver);

const response = await tools.run(
  client,
  { model: 'YOUR_COMPUTER_MODEL', input: 'Find the opening hours on this page', store: false },
  {
    maxSteps: 20,
    beforeAction: async (action) => yourPolicyAllows(action),
    approveSafetyChecks: async (call) => askUserToApprove(call.pending_safety_checks),
  },
);
console.log(response.output_text);
```

Implement `click`, `double_click`, `drag`, `keypress`, `move`, `scroll`,
`type`, and `wait` on the driver. Each gets the existing typed action, including
its `type`, coordinates, held keys, and snake_case fields such as `scroll_y`.
Implement `screenshot()` to return `{ type: 'computer_screenshot', image_url }`
or `{ type: 'computer_screenshot', file_id }`. The URL can be a data URL.
At least one source must be nonempty. Both native source fields may be present.
Methods can be synchronous or asynchronous. The helper never reads local files,
starts a browser, or retries driver effects.

`run` supplies `{ type: 'computer' }` by default. You can pass exactly one
`computer` or `computer_use_preview` tool. It accepts the normal non-streaming
Responses parameters and returns the completed final response. It does not
combine other local tools, streams, background runs, server-side conversations,
or `previous_response_id`. Instead, it replays its full input history, requesting encrypted reasoning for stateless and zero data retention runs.

Computer-only runs also accept Responses `context_management` compaction. The helper replays the
opaque compaction item before continuing. This differs from the mixed runner's local `contextBudget` option.

`maxSteps` is a positive integer that caps calls to `responses.create`, including
the final answer. Its default is 20. The last allowed call cannot trigger further
actions. The client's normal HTTP retries can add network attempts. Pass normal
HTTP options in `requestOptions`. `signal` cancels between requests, actions,
and captures; a running driver method is allowed to finish and is never repeated.
The helper snapshots the request body and its tool list before the first request.
It validates the inputs you pass to `run`. Your OpenAI client is trusted: custom
client hooks or transports can change requests after that validation. Your
application is responsible for those changes.
An initial `tool_choice: 'required'` or forced computer choice applies only to
that request; continuations use `auto` so the model can finish. For
`allowed_tools` in required mode, continuations keep the allowed tools and use
auto mode. A supplied idempotency key applies to the first logical request;
each continuation receives a fresh key and HTTP retries keep that request's key.
This also applies if an approval adds a key to the captured request headers
after the first response. Other current headers, including removals, are kept.
Each continuation captures headers and the idempotency key together, even when
no key is present. Other native request options remain live until dispatch.
Ordinary native `requestOptions` are trusted application configuration. They can
change the path, base URL, or fetch settings after the helper validates its inputs.
The application owns those changes. The helper rejects `requestOptions.body`
because it would replace the validated computer request.
The helper passes the original options object through when no override is needed.
For a signal or continuation override, it passes a view without changing your object.
Custom hooks should read option values rather than depend on object identity.

When the API returns pending safety checks, `approveSafetyChecks` must return
exactly `true` before any of that call's actions execute. There is no automatic
approval. If present, `beforeAction` must return exactly `true` for every action,
including the final screenshot. Return `false` or throw to stop. Both callbacks
receive copies, so edits cannot alter an approved call. They also receive the
effective signal: `approveSafetyChecks(call, { signal })` and
`beforeAction(action, call, { signal })`. When the top-level signal is absent,
the helper uses `requestOptions.signal`. Callbacks that do not use the extra
argument work as before. An interactive approval can listen for abort and
settle promptly; the helper stays busy until the callback actually settles.
Approval covers the action's fixed arguments. It does not freeze the screen or
focus while a person decides. If consent must apply to a particular target, the
driver must bind the action to that target or reject it after a state change.
Run computer actions in an isolated environment with limited network access.
Each `beforeAction` callback receives a fresh, mutable copy of the full call,
including every action and safety check. For modern batches the helper copies
`call.actions` and `call.pending_safety_checks` only when that callback reads
each list. Policies that use only the current action or call ID avoid copying
these lists at every step. Each list is initially an enumerable accessor;
inspecting its property descriptor before reading it shows a getter and setter
rather than a data value.
Reading, assigning, deleting, enumerating, or serializing the call still works
normally. Copies remain isolated across callbacks and from the driver.

Reading either full list on every callback still copies that list each time.
Other call metadata is copied for every callback. The total amount of data
copied can still grow quadratically in those cases. Keep batches practical
for your approval UI.

For other tools or custom continuation, call `await tools.execute(call, options)`
inside your own Responses loop. This validates and executes just that computer
call and returns its `computer_call_output`. Current batched `actions` and
the earlier single `action` are both accepted. The result has exactly one
observation captured after all actions. Intermediate screenshot actions pass
through policy checks without taking redundant captures.
`ComputerCallInput` represents either shape. A modern batch may omit
`pending_safety_checks`; legacy single actions still require a valid checklist.
Approval callbacks keep the native call type and receive an empty array for a
legitimately omitted modern checklist. That copy does not add a field to history.

For a local native desktop, use the [standalone desktop setup](../examples/computer-desktop/README.md).

Browser control uses this computer driver and screenshot contract. A separate
DOM/browser protocol is not part of this helper.
