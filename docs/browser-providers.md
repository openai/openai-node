# Connect a hosted browser or desktop

The SDK accepts caller-owned drivers. It does not ship or manage hosted-provider adapters. A browser provider that exposes CDP can be connected by your application and represented as a partial `BrowserDriver`. A desktop provider can implement the `ComputerDriver` screenshot and input methods. Browserbase and Browser Use supply browser sessions; Daytona and E2B supply remote environments. Choose and configure those providers independently.

Keep credentials, recording and network rules in the application. The SDK's navigation callback cannot enforce provider network, billing or retention policy. Grant only the operations you need and keep output references bound to the current tab and document. Close resources your application owns, and await started actions before handing the environment to another owner. A cancelled waiter does not prove that a remote action stopped.

Pass the driver to `BrowserToolset` or `ComputerToolset`; approval callbacks and independent result checks remain yours. See the [browser contract](browser.md) and [computer contract](computer.md). The [local Fieldwork example](../examples/browser-use-demo/README.md) is a fixed owned fixture, not a hosted adapter.
