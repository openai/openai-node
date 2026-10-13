# Approved files in an owned browser

These examples let an application move one synthetic file for one page task after approval.
The original exercises register ordinary functions with `ResponsesToolRunner`.
The portable exercise uses the optional `upload_file` and `download_file`
members in `BrowserToolset`. It connects to local Chromium through CDP and tests two local sources.
The default browser tools do not include either file member. Only a random
`grant_id` goes to a tool. The application owns the paths, source, expected content,
approval callback, and cleanup.

Use Node.js 22 or later and a source archive from the latest SDK release.
The npm package supplies the SDK, not the example files. From the extracted archive:

```sh
cd examples
npm install --no-save openai@latest playwright@1.63.0
npx playwright install chromium
node responses/browser/exercise-upload.mjs
node responses/browser/exercise-download.mjs
node responses/browser/exercise-portable-files.mjs
```

The modules import installed packages by their public names. These are repository examples;
they are not promised as files in the SDK archive. Chromium runs headless on a new page for each case.
The Responses client uses a synthetic fetch handler and a dummy local credential; you do not need an
API key and no API request leaves the process. The local fixture servers bind only to 127.0.0.1.

`file-upload.mjs` stages each document in its own private area under the system
temporary directory. Approval defaults
to deny and is copied once when the owner is created. Only a strict `true` permits a transfer.
Preparation reads at most 64 KiB plus one byte from an open regular file and keeps the prepared
bytes. Replacing the staging pathname after preparation cannot substitute the bytes. The grant can be used once. It binds the digest, size, page record, control, and session. The page receives one admitted native
transfer; an uncertain result after that admission is reported as unknown and is never replayed.

The application controls the staged file until preparation freezes its bytes.
This example assumes other processes running as the same OS user are trusted;
it does not isolate files from that user before preparation. Later path changes
cannot alter an issued grant's frozen bytes.

The caller supplies the original record and control handles and the expected
record ID before it creates either owner. Select controls in trusted application
code, not from model arguments. For example, with handles `record` and `control`:

```js
const owner = await newDownloadOwner(page, { allowDownload: true, record, control, recordId }, approve);
const grant = owner.issue({ url: sourceURL, count: expectedCount, sha256: expectedDigest }, expiresAt);
const tools = new BrowserToolset(
  {
    state: driver.state.bind(driver),
    download_file: owner.download_file.bind(owner),
  },
  { members: ['download_file'], confirm },
);
```

`sourceURL`, size, digest and expiry come from trusted application data.
`expiresAt` is absolute milliseconds. Use `newUploadOwner` with
`allowUpload` and an original file-input handle for uploads. Its existing
`prepare(root, name, expiresAt)` returns a grant after it reads the private
staging root. Both tool confirmation and owner approval must allow the call.
The owner checks the same original page and controls again after approval.
The methods accept a per-call `{ signal }`. An aborted call does not retire
unrelated owner work.

`file-download.mjs` copies the expected size and digest with an HTTPS source
or a literal loopback HTTP source. It admits at most one native HTTP request.
It refuses URL credentials, fragments, redirects and ambient cookies, auth and
proxy configuration. The parser rejects response headers larger than 8 KiB.
The application reads at most 64 KiB plus one byte and writes at most 64 KiB to a new quarantine file.
It requires the exact identity-encoded content type, expected digest and size, and the original page
and session after the write. It does not follow redirects or attach ambient credentials.

Call `stop()` to revoke pending approval and stop waiting for its callback. It drains preparation
and any admitted transfer before removing the owner's private files. The callback may finish later,
but its result cannot start a transfer. An interrupted approval's grant cannot be reused.
The local exercises cover denial,
changes during approval, expiry, Stop, malformed responses, and no replay through the ordinary runner.
They report digest and byte-count receipts, not file contents.

An owner also exposes `owner.state()`. It returns version 1, direction, the current transfer
outcome, cleanup status, and at most 32 recent changes. `earlier_omitted` is true when older
changes were dropped. Preparation failures appear in the recent list and do not replace a transfer
already in progress. A busy or retired owner records a refused call without replacing the current
outcome. A snapshot can be changed by its caller without changing the owner.

Transfer status is `in_progress`, `refused`, `interrupted`, `unknown`, or `completed`.
The separate `effect` is `none` until transfer admission, `unknown` once delivery may have
started, and `completed` only after the final identity and content checks. For example,
`{"status":"interrupted","effect":"unknown"}` means Stop caught admitted work; it does not
mean the page received nothing. A later Stop does not relabel an earlier timeout as interruption.
Cleanup is `not_started`, `pending`, or `completed`. It stays pending when drain or removal
has not completed; the application can call `stop()` again.

State contains only these fixed values, with no paths, file names, contents, grants, URLs,
credentials, sizes, digests, or error text. The existing `receipt()` still returns the original
per-call transfer result. To expose state to a model, explicitly register an ordinary function:

```js
const fileStatus = {
  tool: {
    type: 'function',
    name: 'file_status',
    description: 'Read bounded transfer and cleanup outcomes.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  execute: () => JSON.stringify(owner.state()),
};
const runner = new ResponsesToolRunner({ functions: [fileStatus] });
```

The exercises register this alongside the grant-only transfer function. A stopped runner never
silently resumes to report status. Read state locally, or make a separate authorized runner call
that registers only the capabilities it still permits.

These limits apply to the application's own reads and quarantine writes. They are not limits on
Chromium, kernel, network, or parser buffering; Stop does not prove erasure of native copies.
The examples do not handle arbitrary browser downloads, export quarantined data, or prove behavior
on remote or authenticated sites.
