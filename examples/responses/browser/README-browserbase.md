# Use the browser driver with a managed session

This source example creates a Browserbase session, connects over CDP, and gives
your callback a restricted browser driver. You can use the same callback with a
Playwright Browser that your application already owns. Both paths create and
close their own context.

## Run the local exercise

Use Node.js 22 or later and a source archive from the latest SDK release.
The npm package supplies the SDK, not the example files. From the extracted archive:

```sh
cd examples
npm install --no-save openai@latest playwright@1.63.0 @browserbasehq/sdk@2.21.0
npx playwright install chromium
node responses/browser/exercise-browserbase.mjs
```

Use your configured package registry. The optional install changes only the
example's `node_modules`; it does not add SDK runtime dependencies. If
Playwright 1.63.0 already has its Chromium installed, skip the install command.
The exercise starts a new, private browser profile with Chromium's sandbox
enabled, uses synthetic provider responses, and sends no model requests.
On success, the command exits with status 0 and each JSON case reports
`"pass": true`. The final summary gives the number of passing cases and `"apiRequests": 0`.

## Pass a driver to a Responses run

Place application code next to this example. Supply your already-configured
provider and OpenAI clients, Playwright's `chromium`, response parameters,
and application policies. No client is closed by this example.

```js
import { BrowserToolset } from 'openai/helpers/browser';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { withBrowserbaseSession, withBorrowedBrowser } from './browserbase-session.mjs';

export async function runOwned({ provider, chromium, client, params, config, confirm, urlPolicy, signal }) {
  const work = async (driver, stopped) => {
    const browser = new BrowserToolset(driver, { confirm, urlPolicy });
    return new ResponsesToolRunner({ browser }).run(client, params, { signal: stopped });
  };
  return withBrowserbaseSession(provider, chromium, config, work, { signal });
}

export async function runBorrowed({ connectedBrowser, client, params, config, confirm, urlPolicy, signal }) {
  const work = async (driver, stopped) => {
    const browser = new BrowserToolset(driver, { confirm, urlPolicy });
    return new ResponsesToolRunner({ browser }).run(client, params, { signal: stopped });
  };
  return withBorrowedBrowser(connectedBrowser, config, work, { signal });
}
```

For an owned session, pass
`{ projectId, allowedOrigins: ['https://your-application.example'] }`.
Use exact HTTP or HTTPS origins without paths or trailing slashes. Borrowed
mode needs `{ allowedOrigins }` and never closes the caller's Browser.
`confirm(context)` must return exactly `true` for changes.
`urlPolicy(context, url)` must return exactly `true` for navigation. Deny
anything your application has not approved. Reads and screenshots can disclose
page content, so give the driver access only to suitable pages.

For human consent tied to a specific page or control, use original refs checked at execution.
Disable `key` and refuse `type` with a null target; both use current focus.
The prior state is not a document lock. See the [approval contract](../../../docs/browser.md#driver-contract).

`read_page` and `find` return a V1 object with `version`, `text`, `elements`,
and `omitted`. Reads cap work and retained refs before constructing the report.
They keep visible form labels and bounded select options, but omit passwords,
hidden fields, private controls and executable option values that do not fit.
`find` scans the current page, even as the first call after navigation.
Like `read_page`, it replaces earlier refs. `get_page_text`
still returns a bounded string and preserves refs. Use `read_page` when you
need omission reasons as well as text. References are checked against current
visible label, native control type, enabled state and DOM destination before
use. If these change, read or find again. Arbitrary JavaScript listener changes
are outside this DOM check.

## Stop and finish cleanup

Abort the supplied `AbortController` to stop. Retain and await the entire
scope promise. Do not race it against Stop or discard it. During setup, Stop
interrupts the wait for context creation and route installation. The scope
retains pending setup for cleanup. Once your callback starts, the scope waits
for it to finish before closing its context.

In `work`, pass the supplied `stopped` signal as `{ signal: stopped }` to
every `ResponsesToolRunner.run()`, `ResponsesToolRunner.iterate()`, and
`BrowserToolset.execute()` call. Those helpers reject new work after Stop
when they receive that signal. The scope cannot prevent direct driver calls
that ignore Stop. Your callback must await all browser work and must not use
the driver after it returns.

A successful scope returns `{ result, status, cleanup }`. A failed or
cancelled scope throws `BrowserSessionError`; cancellation has name
`AbortError`. The error's private `cleanup` handle becomes available after
drain and initial cleanup. Keep the handle in the application, never in model
tools or logs. To retry cleanup, call `await cleanup.retry()` after the scope
settles. Concurrent retries share one attempt.

Owned cleanup validates the saved session ID and project before requesting
release and reading back its status. Each attempt has a deadline and no more
than three reads. A create with no verified result is never retried. Borrowed
cleanup closes only the new context. Status `complete`, `pending`, or
`unverified` reports cleanup observations; it does not attest to task success,
billing, or erasure.

This driver advertises the 15 generic members. It does not enable file
transfers, arbitrary downloads, rich fixture grants, or desktop control.
Context routing and blocked service workers are not a provider firewall. The
launcher owns its pre-import environment, headers, provider logging, and HTTP
client. The example cannot redact logs a supplied client already wrote. The
local exercise does not prove hosted account access, remote context support,
release, or cost.

## What the generic driver can protect

Use this driver only on pages your application has approved for model access.
A page controls its own scripts and DOM. The read filters omit common private
controls; they cannot make a hostile signed-in page safe. Screenshots can show
anything visible. Do not rely on DOM markers as a security boundary against
the page that creates them.

For HTTP(S) tabs, this driver's borrowed and owned state reports only the
origin. It omits paths, queries, fragments, and URL credentials. Borrowed
state keeps `about:blank` as-is and reports only the scheme for other URLs.
The borrowed URL projection must fit 2,048 UTF-8 bytes. The separate 16 KiB
text and 64 KiB report budgets apply to page reads. Page titles and visible
content may still be sensitive, so limit access to suitable pages.

`find` filters matches before its 100-result limit, but it keeps the same
bounded scan and report budgets as `read_page`. A `report_limit` or
`work_limit` omission means later controls may still match. An empty result
with either omission does not mean that the page has no match.

The configured provider client supplies the CDP connection endpoint. Trust it
as part of the connection setup, keep endpoints out of logs and model input,
and configure network access in the environment. A browser navigation policy
does not restrict where the application opens its CDP connection.
This trust includes HTTP discovery and WebSocket redirects followed by Playwright. A connection to a compromised provider requires separate host-network isolation; checking only the initial URL would not enforce that boundary.
