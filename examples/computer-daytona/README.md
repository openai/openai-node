# Borrow a Daytona desktop for computer actions

This example adapts an already-started, caller-owned Daytona desktop to
`ComputerToolset`. It checks one active display and supports a limited set of
pointer and keyboard actions. Your application still owns the sandbox.

Use a source archive from the latest SDK release.
The npm package supplies the SDK, not the example files. From the extracted archive:

```sh
cd examples
npm install --no-save openai@latest '@daytona/sdk@0.220.0' 'pngjs@7.0.0'
node computer-daytona/exercise.mjs
```

The optional install uses your configured registry and does not change the SDK's
runtime dependencies. Use Node.js 22 or later. The
exercise loads the installed Daytona classes but supplies a mocked toolbox
transport. It checks actions, refusals, screenshots, and display changes
through the OpenAI helper. It starts no sandbox and sends no
provider or model request.

## Use a desktop your application already owns

In code next to `adapter.mjs`, pass in the running sandbox's
`computerUse`, a client, model, prompt and your approval callbacks. Supply an
application Stop signal. Approve the initial screenshot before starting the run.

```javascript
import { ComputerToolset } from 'openai';
import { fromStartedDesktop } from './adapter.mjs';

async function runDesktop(
  computerUse,
  client,
  model,
  prompt,
  approveInitialScreenshot,
  approveAction,
  signal,
) {
  signal.throwIfAborted();
  const driver = await fromStartedDesktop(computerUse);
  signal.throwIfAborted();
  if ((await approveInitialScreenshot({ signal })) !== true) {
    throw new Error('Initial screenshot declined.');
  }
  signal.throwIfAborted();
  const image = await driver.screenshot({ signal });
  signal.throwIfAborted();
  return new ComputerToolset(driver).run(
    client,
    {
      model,
      tools: [{ type: 'computer' }],
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: image.image_url, detail: 'original' },
          ],
        },
      ],
    },
    { maxSteps: 20, beforeAction: approveAction, signal },
  );
}
```

The initial screenshot callback receives `{ signal }`, so it can stop waiting
when the user presses Stop. The separate `approveAction` callback uses the
SDK's `(action, call, { signal })` signature.
Return exactly `true` from either callback only for permitted captures or actions. Forward the signal to every
tool or runner call. Pending safety checks require a separate explicit approval
callback; the helper refuses them by default. After Stop or an error, wait for
admitted work to settle before your application retires the sandbox. Never replay
an uncertain remote input. This adapter does not create, start, stop, or delete
a Daytona sandbox and does not revoke access to other owners.

## Supported subset and limits

Take a full-screen screenshot before the first pointer action. The adapter
requires exactly one active display at (0, 0), with an integer ID and positive
dimensions. It rechecks those fields before pointer input. A change retires the
adapter, including keyboard input; create a new adapter and capture fresh state.
A same-size replacement with the same reported ID cannot be detected.

In-bounds left and right clicks, left double-click, move, exactly two-point drag,
text, keypress, screenshot and a one-second wait are supported. Keypress preserves
single characters and accepts ctrl, alt, shift or cmd before the last key; common
arrow and modifier aliases map to Daytona names. The adapter refuses every scroll,
extra button, pointer action with held keys, and drag with any other number of
points. It does not approximate pixel scroll distances with wheel steps or split
a drag into repeated inputs.

The PNG check validates the original dimensions, complete image data and checksums.
It cannot prove who produced the pixels. Provider transport failures, isolation, sandbox exclusivity,
release, network restrictions, private viewing and logging remain the
application's responsibility. This example proves local conformance with a
mocked provider transport only. It provides no hosted lifecycle, network or
privacy proof.

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

The encoded PNG byte budget defaults to `2 * ((8 * width + 1) * height) + 65_536`,
capped at the largest safe integer. This allows twice the largest 16-bit RGBA
scanlines plus 64 KiB for headers and metadata. It is an example memory budget,
not a PNG format limit. A valid image with unusually large metadata may exceed
it. Choose another positive safe integer as the third factory argument when needed:

```javascript
const driver = await fromStartedDesktop(computerUse, undefined, 128 * 1024 * 1024);
```

The adapter checks the returned base64 length before it allocates the decoded
PNG. Daytona has already returned the provider string at that point, so this
budget does not bound provider-side or transport memory. An over-budget frame
revokes pointer access until the adapter captures a matching frame.
