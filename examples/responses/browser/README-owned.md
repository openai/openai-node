# Owned fixture references and rich reads

Follow the [package and browser setup](../../browser-use-demo/README.md#setup),
then run `node responses/browser/exercise-owned.mjs` from `examples/`.
This exercise starts an isolated browser and a local server. It makes no API requests.

Use the URL's canonical browser spelling in every fixture declaration: a lowercase host,
an explicit path (`/` for the root), no default port, no dot path segments, and no fragment.
For example, use `https://fixture.example/`, not `https://FIXTURE.example:443`.
Noncanonical declarations are rejected. Use the same exact URL in `urls`, `publicValues`,
and `publicViewports`; the driver does not rewrite these permission keys.

Use `createBrowserDriver(context, { ownedFixture: { urls, publicValues } })` only with a disposable context and fixtures you control. The launcher must create that context with `await browser.newContext({ serviceWorkers: 'block' })` before it opens any pages. The driver installs the HTTP and WebSocket guards; it cannot retroactively block service workers. `urls` lists exact installed HTTP(S) page and request URLs, including the fixture's action endpoint. This opt-in delegates permission to close the context on an uncertain action. The single-argument driver keeps normal Playwright behavior.

Create one driver and one SDK toolset for each context. The launcher must serialize admitted work through that owner and drain it before handing the page to a person. A ref binds to the observed element and remains reusable while its identity matches. It is not a single-use permission or a way to coordinate two independent toolsets. A failed or cancelled navigation after browser dispatch retires the driver; owned mode also closes its disposable context. Validate a fresh task before starting again.

Run `node responses/browser/exercise-network.mjs` for local request checks. It uses disposable loopback servers and Chromium, with no API calls. Choose `basic`, `redirects`, `origin`, `chain`, or `popup` as the last argument to inspect one boundary.

The context guard supports direct allowlisted requests. It refuses every HTTP 301, 302, 303, 307 or 308 before fetching a target, including an allowlisted target. A 304 remains an ordinary response. No redirected request is retried. An initial POST might already have acted; the launcher must reconcile that effect. Allowed redirects are unsupported requests, not URL-policy refusals.

The guard buffers each allowed HTTP response to reject redirects before they are followed. It supports finite responses and has no separate 30-second fetch timeout. Action timeouts and session cancellation still apply. Open-ended response streams require network enforcement outside this guard.

A denied popup may leave Chromium's error document open. The driver refuses state and current-tab operations on that document; it cannot give an SDK caller a usable starting state or tab ID. The owning launcher must close the blocked Playwright page or the whole context. This is launcher cleanup, not agent or SDK recovery.

These are browser request guards, not an OS firewall; they do not establish WebRTC, DNS, host-process or provider egress isolation.

Each supported element must sit inside `[data-record-id]`. Fixture handlers must capture an immutable record ID when they bind. Do not use this mode with arbitrary site callbacks or private titles. State displays an origin, while the network policy checks exact URLs. Visible business names and IDs remain searchable; raw record IDs, field keys and URLs are not included in read results.

The three reads return BrowserReadV1 objects. `read_page(all)` includes privacy-filtered rendered text and supported targets; `interactive` returns targets plus read-only remote summaries. `find` filters visible labels while traversing, before the 100-target limit. `get_page_text` returns no targets and preserves existing refs. Every target read, including a find with no match, invalidates earlier refs.

Names use visible same-root aria-labelledby entries, then aria-label, visible native labels, rendered text, and placeholder. This is a privacy-filtered subset, not full AccName. Hidden content and controls inside labels never supply their values. `data-browser-private` denies text, names, refs and values through inspected composed ancestors. Password, file and hidden inputs always deny access.

Field values and select options are private by default. To publish a known fixture field, supply immutable launcher declarations such as:

```js
const publicValues = [
  [fixtureURL, 'T-1042', 'guest'],
  [fixtureURL, 'T-1042', 'team'],
];
const driver = createBrowserDriver(context, { ownedFixture: { urls, publicValues } });
```

The driver copies these tuples once. The control must have the exact `data-browser-field` key within that record and installed document. A page marker alone grants nothing. A private field or selected option still denies its value. Text filtering does not redact screenshots; the launcher owns pixel privacy.

Reports include omission codes, not a claim that all page content was observed. The driver visits at most 2,000 nodes/lookups over 16 frames and eight frame/shadow levels; labels, slots, nonmatches, hidden siblings and options share the work budget. Text is at most 16 KiB; up to 100 targets have 32 options each, with a total 64 KiB projected JSON budget. It never issues a ref for a discarded target. `unsupported_root` remains present because an inaccessible or closed root cannot be ruled out.

The driver supports these native controls through the existing `type`, `click` and `select_option` tools:

| Control                        | Read role             | Action and fixture events                                                                                                                  |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Button                         | `button`              | `click` invokes a native DOM click.                                                                                                        |
| Text input, textarea           | `textbox`             | `type` sets literal text and emits `input`.                                                                                                |
| Date input                     | `textbox`             | `type` accepts a valid `YYYY-MM-DD`, or empty when optional. It emits `input` then `change`.                                               |
| Range input                    | `slider`              | `type` accepts the exact representable value under native min, max and step constraints; it emits `input` then `change`.                   |
| Checkbox, radio                | `checkbox`, `radio`   | `click` invokes a native DOM click. Browser events follow native state changes; clicking an already selected radio does not toggle it off. |
| Single select, multiple select | `combobox`, `listbox` | `select_option` accepts one value or, for multiple select, the entire desired set including `[]`. It emits `input` then `change`.          |

Values, checkbox/radio `checked`, and listbox `options[].selected` require the same exact launcher tuple described above. Without that tuple, reads omit these fields and report `value`. Text-only reads return no controls, values, options or checked states. A private selected option prevents publication of the control's values. Unsupported custom widgets and password/file/hidden fields never gain refs from a tuple.

The driver checks the held element, logical record, native and declared role, normalized name, field identity, visibility and action in one browser task. Date/range values are validated on a detached native control before any target events. A select checks the entire desired set first, including duplicate, missing, disabled and private options and options that would be cleared. A checkbox or radio observed before approval must retain its checked state; radio peers must retain their identities, record and checked states. Named native groups include external inputs with the same form owner and tree root. Unnamed radios are independent.

The driver does not emit trusted pointer events, focus the element or wait for it to become ready. For date, range and select, it rechecks immutable target, type and record identity between `input` and `change`; the intended value change is allowed. If the first event recycles the record or makes the result uncertain, it refuses further events and retires the owned context. Invalid native forms refuse before validation callbacks. Custom editors, hover, key input and typing without a ref are unsupported.

Run `node responses/browser/exercise-forms.mjs` after the package and browser setup above. This exercise serves disposable loopback fixtures, runs the real browser and SDK helper, and checks native FormData, checked/selected state, events and fixture receipts. It needs no API key or model and makes no API requests. It also covers denied/private values, rejected held approvals, mounted open-shadow and same-origin frame controls, covered ancestors and retirement after a changed record.

Open shadow roots and mounted slotted rows are supported. Same-origin installed child frames are actionable only while every ancestor is visible and untransformed. Covered, detached, private or transformed ancestors refuse. Reveal and read again. Exact installed remote frames can supply bounded `Read only: remote frame` summaries after exact parent-handle checks. Reports carry `remote_action` and never issue remote refs, since parent checks and a later child action cannot be atomic across realms.

After a driver-observed lost reply, the context is retired before close starts. A new read, approval or ref cannot resume it. Start a new owned context. If the SDK cancels after the driver returned, the driver cannot see that cancellation. The application must drain admitted work or close the context before handoff, and reconcile the result.

The existing 100-tab observation limit applies to live owned tabs at
registration. Closing a tab frees a slot. A 101st live tab retires the driver
and closes only its disposable owned context; it cannot close a caller's
borrowed browser.
