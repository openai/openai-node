# Use an E2B desktop with computer tools

This optional example connects the SDK's computer tools to your running E2B
desktop. It supports left and right clicks, left
double-clicks, mouse movement, text, key chords, screenshots, and a one-second
wait. It does not create or stop a sandbox.

Use a source archive from the latest SDK release.
The npm package supplies the SDK, not the example files.

## Run the local exercise

Use Node.js 24.19.0. The local exercise
also passes on Node.js 22.23.2. Node.js 22.0.0 cannot load the pinned E2B package:
its CommonJS entry point requires an ES module. This optional example therefore
needs a newer runtime than the core SDK's minimum. From the extracted archive:

```sh
cd examples
npm install --no-save openai@latest '@e2b/desktop@2.4.0' 'e2b@2.52.0' 'pngjs@7.0.0'
node computer-e2b/exercise.mjs
```

Use your configured package registry. The optional install changes only this
example's dependencies; it does not add SDK runtime dependencies. The exercise calls the
installed E2B input methods with controlled command and file services. It checks
the commands and SDK tool outputs, sends no provider or model requests, and
does not start a desktop.

## Add the driver to your application

Supply your running desktop, OpenAI client, model name, prompt, and approval
callbacks. Connect your application's Stop control to the signal.
Keep the desktop private to this run. Send its first screenshot with the prompt
so the model can see where to act.

```javascript
import { ComputerToolset } from 'openai';
import { ResponsesToolRunner } from 'openai/helpers/responses-tool-runner';
import { E2BComputer } from './adapter.mjs';

async function runDesktop(desktop, client, model, prompt, approveInitialScreenshot, approveAction, signal) {
  signal.throwIfAborted();
  const driver = await E2BComputer.fromStartedDesktop(desktop);
  try {
    signal.throwIfAborted();
    if ((await approveInitialScreenshot({ signal })) !== true) {
      throw new Error('Initial screenshot declined.');
    }
    signal.throwIfAborted();
    const image = await driver.screenshot({ signal });
    signal.throwIfAborted();
    const computer = new ComputerToolset(driver);
    const params = {
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: image.image_url, detail: 'original' },
          ],
        },
      ],
    };
    return await new ResponsesToolRunner({ computer }).run(client, params, {
      signal,
      maxSteps: 20,
      computerOptions: { beforeAction: approveAction, signal },
    });
  } finally {
    await driver.close();
  }
}
```

The initial screenshot callback receives `{ signal }`. Use it to stop waiting
for approval when the user presses Stop. The separate `approveAction` callback
uses the SDK's `(action, call, { signal })` signature.
Return exactly `true` from either callback only when your application permits
the capture or action. Forward Stop to every runner or tool execution.
Await an admitted operation before cleanup. Stop does not undo a remote action
or guarantee that a pending provider call ends. Do not share the driver with
other tasks or use it after closing it.

The driver removes only its own temporary screenshot files. As data arrives, it
checks the PNG header against the original dimensions and configured pixel budget.
It checks each chunk against the encoded byte budget before retaining it, then
validates and decodes the complete PNG. Size application memory for both the
encoded image and its decoded pixels.
It returns the image only after removal succeeds. A failed operation or changed
desktop retires the driver. If cleanup fails, keep the driver and call `close()`
again after the active operation ends. Never replay an uncertain input action.
Your application still owns sandbox release, network restrictions, provider
timeouts, private viewing, and any provider logging.

## Limits

Drag, pixel scrolling, extra mouse buttons, and held mouse modifiers raise an
error before input. The provider's drag method cannot guarantee release after
failure, and wheel steps do not establish pixel distance. A model can request
these actions, so handle the failed run instead of silently approximating them.

Key chords accept the named modifiers, common navigation keys, F1 through F12,
and single ASCII letters or digits. Names are case-insensitive; use text input
for letter case. Text must be valid Unicode without NUL and fit in 4096 UTF-8
bytes. One provider write preserves characters across its usual chunk boundary.

The local exercise does not prove hosted access, remote display identity,
desktop exclusivity, sandbox release, or network isolation. Matching dimensions
cannot detect every same-size display replacement. Those checks need a real,
private provider run before this example can claim hosted support.

## Screenshot limits

The adapter accepts non-interlaced PNG screenshots only. Its default pixel budget
is 33,177,600 pixels, the area of a 7680 by 4320 display. It rejects a larger
display before capturing a screenshot. To change the budget, set `maxScreenshotPixels` as the factory's second argument.
Use a positive integer and choose a value your application can afford to decode.
Raising the pixel budget does not enable interlaced PNGs. Providers that return
interlaced PNGs are unsupported by this example.

The pixel budget limits image dimensions, not total process memory. PNG bit depth,
compressed input and decoder buffers also use memory. The existing complete-image
and checksum checks still apply. This setting does not override limits enforced
by the image decoder.

The encoded byte budget defaults to `2 * ((8 * width + 1) * height) + 65_536`,
using the actual desktop dimensions and capped at JavaScript's largest safe
integer. This allows twice the raw 16-bit RGBA scanline size plus 64 KiB for
encoding overhead. It is this example's memory budget, not a PNG format limit.
A valid image with unusually large metadata may exceed it. To set a different
budget, pass `maxScreenshotBytes` as the factory's third argument:

```javascript
const driver = await E2BComputer.fromStartedDesktop(desktop, 7680 * 4320, 128 * 1024 * 1024);
```

Use a positive safe integer. Omit it or pass `null` to use the derived budget.
An over-budget stream is closed, its temporary file is removed, and the driver
retires. The caller still owns the overall time limit: pass a signal with a
deadline when required. A stream idle timeout does not limit total transfer time.
