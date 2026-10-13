# History, targeted scroll and visible waits

The optional owned-fixture driver adds history navigation, `scroll_to` and
`wait_for` to browser tool runs. Use only fresh disposable Playwright
contexts and fixtures controlled by the launcher. Create the context with
`serviceWorkers: 'block'` before opening any pages. See
[Owned fixture references](../examples/responses/browser/README-owned.md)
for exact URL and public-field declarations.

`navigate({url, tab_id})` keeps its current arguments. The fixture driver
recognizes exactly `back`, `forward` and `reload` in `url`. Both the
URL policy and confirmation callback still receive the original string.
Allowing `back` approves a history operation, not an unseen destination
URL. Policies that allow only explicit URLs can safely refuse these keywords.
History invalidates old refs even when there is no entry; the response says
`History navigation checked.` with validated current state. Read again for
fresh refs. Same-document history does not count as BFCache support.

`scroll_to({target, tab_id})` requires confirmation and a ref from an earlier
visible read. It can bring that observed control back into its nested viewport.
It refuses recycled, hidden, private, disabled, covered, unsupported-frame and
foreign refs. It does not discover never-observed controls. Scroll clears refs:
read again before click, type or select. The original `scroll` still uses the
example's CSS pixel deltas; it is not exposed by the owned driver.

`wait_for({text, timeout_ms, tab_id})` is a read and does not ask for irrelevant
confirmation or URL policy. `text` must be nonempty scalar Unicode, up to 256
UTF-8 bytes after whitespace normalization. `timeout_ms` is an integer from
1 through 30000. This wait searches only the same privacy-filtered text as
`get_page_text`, without creating refs. It reports `Visible condition met.`
or a controlled `Visible condition timed out.` error. Navigation, handoff,
closed tabs and caller cancellation prevent later success on another document.

Only implementations of the two new members advertise them. Existing drivers
keep their original one-argument methods. A driver implementing `wait_for`
receives its caller's cancellation signal as the second argument:

```ts
const driver = {
  state: reportCurrentState,
  async wait_for(args, { signal }) {
    // Observe only launcher-approved visible state under one deadline.
    signal?.throwIfAborted();
    return await waitForVisibleState(args, signal);
  },
};
```

In the fixture driver a responsive read and its pauses share one monotonic
deadline. No wait sends extra model requests. The existing runner request cap
still applies. A blocked browser thread or a driver ignoring cancellation can
exceed the elapsed timeout: the helper never reports that work drained before
it settles. Revoke the owned environment or await the real operation before
granting another owner control. This is not a workflow time or spend cap.

After building the SDK and installing the optional Playwright browser, run
`node examples/responses/browser/exercise-navigation.mjs`. It uses loopback
servers and disposable Chromium only, with no OpenAI or provider requests.
The proof does not cover BFCache, borrowed contexts, arbitrary websites,
provider network isolation or hung-page timeout guarantees.
