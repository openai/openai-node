# Route a case, approve its receipt, and save in an isolated desktop

For installed Chrome on Linux, see [Choose a local browser](../../../docs/browser.md#choose-a-local-browser).

This optional example runs one Responses session across two clearly named
workspaces. The host browser contains a fresh local Dispatch receipts page.
The native computer is a separate disposable Linux desktop with an editor.
An ordinary application function checks the fixed receipt before disclosing
its public text. No new browser tool or computer API is needed.

Use Node.js 22 or later. The npm package supplies the SDK, not these example
files. Use a source archive from the latest SDK release. From the extracted archive:

```sh
cd examples
npm install --no-save openai@latest playwright@1.63.0
npx playwright install chromium
node responses/browser/exercise-mixed.mjs
```

Keep this shell in `examples/` for the commands below. Both workspaces use
the same installed SDK without a source build. The default exercise makes no
API calls. It drives real task-owned Chromium
and a real 127.0.0.1 HTTP fixture through the SDK, with a simulated native
computer. It checks the success path, each approval denial, wrong IDs and
extra function arguments, altered and partial receipt bytes, an unadmitted
Route POST, blocked browser navigation, and Stop while the consent callback
returns a late approval. It does not
prove that Linux saved a file.

For that check, on an Apple-silicon Mac follow the
[desktop guest setup](../../computer-desktop/guest/README.md). Supply your
trusted, private runtime directory to run two sequential, disposable VMs:

```sh
npm install --no-save openai@latest playwright@1.63.0 pngjs@7.0.0
node responses/browser/exercise-mixed.mjs --runtime-dir /private/tmp/desktop-$UID
```

The real native lane checks one complete run and one denied desktop action.
Each run has its own browser, file grant, VM and receipt. The fixed guest file
must match the disclosed receipt; the guest browser must have zero fixture
effects. Both runs stop their owners before a second run begins. The runtime
path comes from the launcher, never from page or model output.

For an API run, set OPENAI_API_KEY and OPENAI_MODEL and pass --live:

```sh
node responses/browser/mixed-run.mjs --live --runtime-dir /private/tmp/desktop-$UID
```

This can spend API credits. It asks before creating both workspaces, before
host browser changes, before fetching and disclosing the receipt, and before
native editor inputs or pending safety checks. Only "yes" approves. Ctrl-C
cancels pending startup and marks Stop while any admitted operation drains. Refusal or Stop
ends the session and closes its owners. The example does not roll back a
Route or erase pixels already sent to the API. This terminal keeps its one-phase flow; it never transfers control silently.
For Take/Return within this same host and guest task, use the
[Fieldwork dashboard](../../browser-use-demo/README.md).

The browser guard permits only the fixed /dispatch and /route endpoints.
Browser navigation can open /dispatch only. The fixed /result download is
handled by the existing [file owner](README-files.md), outside Chromium,
with a one-use grant, byte and digest checks and a private quarantine. The
session returns only the already trusted 22-byte fixture receipt after
successful verification and explicit disclosure consent; it does not read
the quarantine or expose its name. Native input is limited to screenshot,
wait, left click or move on the editor half, the exact disclosed text, and
Ctrl+A or Ctrl+S. This is a controlled local task, not support for arbitrary
sites, browser downloads or a general desktop filesystem policy.

The printed proof contains fixed status values, effect counts, and independent
guest booleans. It does not print raw model output, images, tool arguments,
URLs, grants, paths or exception text. A verified result requires the host
driver's completed click of the observed Route reference and a matching HTTP
receipt, one completed transfer, disclosure, the exact nonempty guest file,
zero guest browser effects, and successful cleanup. A stopped or uncertain
run never reports success merely because the model says it finished.

The file proof retains only status, attempted, completed and disclosed.
File and desktop uncertainty are separate: an incomplete response after a
file request reports unknown even if no native desktop action has run.
It must not be presented as a declined request with no possible effect.

The mixed owner stores each phase's complete SDK checkpoint in a private
temporary ledger. It counts committed `consumed_requests` deltas against one
20-call budget, and keeps phase-prefixed effect IDs separately. It deletes a
ledger only after the entire runner lease settles. No old call or conversation
is replayed. The terminal still finishes and closes both workspaces after its
one phase.
