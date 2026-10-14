# A disposable desktop for ComputerToolset

This optional example uses a private VM or local container for a fixed task. It
opens a real browser with a local ticket and a text editor. ComputerToolset
sends native computer actions to that desktop. A fixed check verifies the
browser event and saved receipt. Run it from the Node SDK checkout or source
archive, with the SDK built from that source.

## Setup and no-key exercise

Use Node.js 22 or later and the pnpm version in the root `package.json`.
From the SDK checkout or source archive root, build and install this source:

```sh
pnpm install --frozen-lockfile
pnpm build
cd examples
npm install --no-save ../dist pngjs@7.0.0
cd ..
```

For the VM, use an Apple-silicon Mac with virtualization enabled, Python 3.10
or later, and trusted vfkit and xorriso executables on PATH. See the
[guest prerequisites](guest/README.md#before-the-first-run) for tool versions
and upstream installation instructions. From the SDK root, run:

```sh
python3 examples/computer-desktop/guest/setup.py --runtime-dir "/tmp/desktop-$(id -u)"
```

For a local container on x86-64 Linux, select that backend explicitly:

```sh
python3 examples/computer-desktop/guest/setup.py --backend container --runtime-dir "/tmp/desktop-$(id -u)"
```

See [guest instructions](guest/README.md#optional-local-linux-fixture) for
Docker prerequisites. Setup verifies and records the selected runtime, and
reuses a matching one. The VM instructions also cover offline media and
executable overrides.

Use a short absolute path, such as `/private/tmp/desktop-$UID`. The runtime
and its `runs` directory must belong to you and have mode 0700. Paths cannot
contain spaces, commas or percent signs. The launcher checks the path against
macOS's Unix socket limit. The build instructions produce `bin/vfkit` and
the owned read-only `build/desktop.raw`.

VM setup and launch resolve the runtime to its canonical path. Each ancestor must
belong to root or the current user and must not be writable by other users
unless it is a sticky directory such as /private/tmp. The example trusts the
current host user; it does not protect against that user's deliberate file
replacement.

The VM launcher keeps a parent-liveness pipe open. If the SDK process crashes
or is killed, a small foreground owner stops and reaps its exact VM child.
Normal Stop still removes the private run directory. After a forced SDK exit
or host reboot, run directories can remain; remove them manually only after
all owners using that runtime have stopped.

Run the no-key exercise from the SDK root:

```sh
node examples/computer-desktop/exercise.mjs --runtime-dir "/tmp/desktop-$(id -u)"
```

The exercise makes no API calls and needs no credentials. It uses the public
ComputerToolset methods, then checks an independent fixture event and fixed
output file. It covers screenshot dimensions, valid and invalid inputs,
declined action and safety checks, Stop during held approval, and a second
unchanged desktop. It exits with an error if any check fails.

Also run the offline lifecycle regression check:

```sh
node examples/computer-desktop/exercise-lifecycle.mjs
```

This check uses only Node built-ins and a temporary simulated process and
Unix socket. It verifies failed startup, an input followed by a lost reply,
and Stop while input is still pending. It checks that the exact child and run
directory are removed and another owner remains usable. It does not boot
Linux or prove Chromium behavior; use the real VM exercise above for that.

Only trusted launcher code supplies `runtimeDir`:

```js
const desktop = await Desktop.create({ runtimeDir: '/private/tmp/desktop-runtime' });
try {
  await desktop.withComputer((computer, signal) =>
    computer.execute(call, { signal, beforeAction: () => true }),
  );
} finally {
  await desktop.stop();
}
```

The literal runtime path above is an example; use the path you built. Never
take it from a tool call, page, or model output. The caller must forward the
supplied signal to ComputerToolset.

## Optional API run

After the no-key exercise passes, set OPENAI_API_KEY and OPENAI_MODEL in the
host environment. Then run:

```sh
node examples/computer-desktop/run.mjs --live --runtime-dir "/tmp/desktop-$(id -u)"
```

This command can spend API credits. It asks you to authorize the fixed local
task and asks separately when the API requests a safety decision. Credentials
stay in the host SDK client. Ctrl-C stops the owned desktop. During startup,
Stop waits for creation to settle (up to 90 seconds), then removes the guest
before any API call. The final output
contains only the verifier result and the uncertainty flag.

## Ownership and limits

`verify()` observes the current fixed records. When both records match,
the example refuses further input; verification and screenshots remain available.
Seal the result or start a new desktop. This protects already completed records;
it does not acknowledge GUI work queued before they first matched.
Before reporting the result as final, call `seal()` and check its
returned records again: a save may have changed them since the earlier check.
Sealing stops the guest browser and editor and drains the fixture writer.
The last frame captured before shutdown stays available for reference.
Use the returned records to verify the final result. Further input is refused.
Start a new desktop for any more work. Stop still removes the sealed guest.

On macOS, each Desktop starts its own VM with a fresh private socket and EFI
store. It accepts no existing guest ID, PID or socket. The VM has no network
device or host directory shares. Its disk is read-only, with small temporary
guest filesystems. On Linux, the local container uses the isolation settings
described in the [guest instructions](guest/README.md#optional-local-linux-fixture).
Both keep the browser sandbox enabled. No host browser profile, screen or API
key enters the guest.

Stop blocks new work and waits up to five seconds for the complete SDK call.
It then terminates and reaps that exact guest before removing its private run
directory. If native input was still pending, `uncertainEffects` becomes
true. Unknown outcomes retire the desktop and are never retried. Another
Desktop's VM and files remain untouched. If reaping fails, the run directory
is retained and Stop raises an error.

This example supports only the disposable fixture on the exact host and guest
versions verified in the build instructions. Four guest CPUs and 4 GiB RAM
are VM assignments, not exact host process or memory limits. Host-user
compromise, other host operating systems, arbitrary apps, and remote providers
are outside its scope. A failed guest or sandbox startup is a failed run; do
not weaken the sandbox.
