# Fieldwork: book a table

One local browser task, with a visible result and human control.
The agent fills a synthetic booking, then asks before submitting. The app verifies the four form values and the confirmation. It never books a real table.

## Setup

Download the release source matching the installed SDK. From its `examples` directory:

```sh
npm install --no-save openai@latest playwright@1.63.0
npx playwright install chromium
node browser-use-demo/server.mjs
```

Open the private link printed in your terminal. Select **Local rehearsal** to exercise the real browser without a key or API call. Rehearsal uses scripted Decisions choices and is not a model benchmark.

For a live run, set `OPENAI_API_KEY` and `OPENAI_MODEL` on the server before launch. Responses is the default. Choose Decisions only when you want to present the complete list of allowed actions. You can set `OPENAI_RESPONSES_MODEL` or `OPENAI_DECISIONS_MODEL` separately. The local browser receives neither the key nor the server environment.

Use **Take control** to stop agent work and wait for it to drain. Click the actual browser image, type, or scroll. **Return to agent** reads fresh browser state before resuming. **Stop** closes the context and refuses new work until cleanup finishes. Refused approval ends the run.

The driver accepts only the exact disposable booking fixture URL. It does not implement a general web browser or a provider connection. To start with read-only content, use the [local reader](../responses/browser/README-read-only.md). For a native desktop, follow the [standalone setup](../computer-desktop/README.md).

## Local check

```sh
node browser-use-demo/exercise.mjs
```

This uses the real browser and SDK with local scripted decisions. It checks authentication, live frames, stale controls, approval, Take/Return, Stop and the actual final form.
