# Navigation, targeted scroll and visible waits

Browser tools are exposed only for driver members your application implements.

`navigate({url, tab_id})` receives the original URL string. If your driver supports `back`, `forward` or `reload`, its policy must check the actual destination before use. Approval for history is not approval for an unknown destination. Navigation, handoff and page changes must invalidate old action references.

`scroll_to({target, tab_id})` requires confirmation and a current reference. Refuse stale, hidden or out-of-scope targets, then ask the caller to read again.

`wait_for({text, timeout_ms, tab_id})` is a read. It does not ask for irrelevant action confirmation or URL policy. The SDK accepts nonempty Unicode text up to 256 UTF-8 bytes after whitespace normalization and an integer timeout from 1 through 30000 ms. Drivers implement the actual deadline and propagate cancellation. A completed wait is not a new action reference.

See [browser tools](browser.md#driver-contract) for partial drivers. The local booking driver deliberately does not advertise navigation, scroll_to or wait_for.
