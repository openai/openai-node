# Use a standalone Browser Use browser

This example creates a standalone browser with the optional `browser-use-sdk`
package. It connects through Chrome DevTools Protocol (CDP) and opens a fresh
restricted context. Your callback receives the SDK's browser driver for that context.

## Run the local exercise

Download **Source code (zip)** from the
[Node SDK release page](https://github.com/openai/openai-node/releases/latest).
Unpack it, open its `examples` directory, and use Node.js 22 or later:

```sh
npm install --no-save openai@latest browser-use-sdk@3.4.2 playwright@1.63.0
npx playwright install chromium
node responses/browser/exercise-browser-use.mjs
```

The exercise runs a local browser and supplies synthetic provider responses
from a local HTTP server. It needs no provider account or API key and makes no
model requests. Success reports 20 passing cases.

## Run your own task

Put your application next to `browser-use-session.mjs`. Supply a provider key,
its trusted base URL, exact allowed origins, and your OpenAI client:

```js
import { chromium } from 'playwright';
import { BrowserToolset } from 'openai/helpers/browser';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { withStandaloneBrowser } from './browser-use-session.mjs';

const receipts = [];
const result = await withStandaloneBrowser(
  chromium,
  allowedOrigins,
  async (driver, signal) => {
    const browser = new BrowserToolset(driver, { confirm, urlPolicy });
    return await new ResponsesToolRunner({ browser }).run(client, params, { signal });
  },
  {
    apiKey: providerKey,
    baseUrl: providerBaseUrl,
    signal: controller.signal,
    onCleanup: (handle) => {
      receipts.push(handle);
    },
  },
);
```

Each origin must be an exact HTTP or HTTPS origin without a path or trailing
slash. The scope copies the list before its first request. Later changes cannot
expand the task's access. Pass the supplied `signal` to every runner or tool call.
Await all browser work before your callback returns.

The generic driver exposes 15 methods. It blocks service workers and downloads
in its new context. Browser request routing is not an operating-system firewall;
configure the environment's network access for your application.

Use the lightweight provider client. Sharing a running Browser Use agent engine
is unsupported because its browser-wide observers can affect other contexts.
For a Playwright browser you already own, use
[the borrowed-browser example](README-browserbase.md). It creates and closes
only its own context.

## Stop and cleanup

Call `controller.abort()` to request Stop, then await the scope. It waits for
admitted work to settle before cleanup. A callback that ignores its signal can
delay Stop. Cancellation cannot undo an action that already ran.

The scope creates one browser with no client retries, a one-minute provider
timeout, proxy disabled, and recording disabled. It keeps the returned UUID and
requires the same ID, active status, and an explicit null `agentSessionId` before
connecting. Cleanup closes its own context and CDP connection. It checks that
identity again, requests Stop, and reads back the stopped state. It never
lists sessions, guesses an ID, or retries creation after a lost response.

`onCleanup(handle)` is required. Store the handle synchronously, without throwing
or returning a promise. The callback runs once after work has drained and the
first cleanup attempt has finished. The result and sanitized errors also carry
the handle. It is private: keep it out of logs, tool output, and model input.

Cleanup reports `complete`, `pending`, or `unverified`. A failed close or request
can leave cleanup pending; retry with `await handle.retry()`. Concurrent retries
share one attempt. A missing, changed, or agent-owned identity is unverified and
cannot authorize Stop. A missing `agentSessionId` field also stays unverified.

These local checks verify the installed provider client's request contract and
the example's lifecycle. They do not verify hosted access, provider isolation,
account permissions, billing, or partner publication. Configure your environment
and logging before importing provider packages.

The configured provider and base URL are trusted connection setup. Their CDP
endpoint may differ from the API host. Keep that endpoint private and enforce
connection policies in your application or network environment. For page and
URL disclosure limits, see the generic borrowed-browser guide. This trust includes HTTP discovery and WebSocket redirects followed by Playwright. A connection to a compromised provider requires separate host-network isolation; checking only the initial URL would not enforce that boundary.

Each cleanup attempt bounds its local close wait. A pending local close cannot
block the provider identity check and Stop after application work has drained.
Cleanup reports complete only after both local close and matching provider Stop
are confirmed; retries wait for the same pending close.
