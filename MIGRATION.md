# Migration guide

This guide outlines the changes and steps needed to migrate your codebase to the latest version of the OpenAI TypeScript and JavaScript SDK.

The main changes are that the SDK now relies on the [builtin Web fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) instead of `node-fetch` and has zero dependencies.

## Migration CLI

Most programs will only need minimal changes, but to assist there is a migration tool that will automatically update your code for the new version.
To use it, upgrade the `openai` package, then run `./node_modules/.bin/openai migrate ./your/src/folders` to update your code.
To preview the changes without writing them to disk, run the tool with `--dry`.

## Environment requirements

The minimum supported runtime and tooling versions are now:

- Node.js 20 LTS (Most recent non-EOL Node version)
- TypeScript 4.9
- Jest 28

## Breaking changes

### Web types for `withResponse`, `asResponse`, and `APIError.headers`

Because we now use the builtin Web fetch API on all platforms, if you wrote code that used `withResponse` or `asResponse` and then accessed `node-fetch`-specific properties on the result, you will need to switch to standardized alternatives.
For example, `body` is now a [Web `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) rather than a [node `Readable`](https://nodejs.org/api/stream.html#readable-streams).

```ts
// Before:
const res = await client.example.retrieve('string/with/slash').asResponse();
res.body.pipe(process.stdout);

// After:
import { Readable } from 'node:stream';
const res = await client.example.retrieve('string/with/slash').asResponse();
Readable.fromWeb(res.body).pipe(process.stdout);
```

Additionally, the `headers` property on `APIError` objects is now an instance of the Web [Headers](https://developer.mozilla.org/en-US/docs/Web/API/Headers) class. It was previously defined as `Record<string, string | null | undefined>`.

### Named path parameters

Methods that take multiple path parameters typically now use named instead of positional arguments for better clarity and to prevent a footgun where it was easy to accidentally pass arguments in the incorrect order.

For example, for a method that would call an endpoint at `/v1/parents/{parent_id}/children/{child_id}`, only the _last_ path parameter is positional and the rest must be passed as named arguments.

```ts
// Before
client.parents.children.retrieve('p_123', 'c_456');

// After
client.parents.children.retrieve('c_456', { parent_id: 'p_123' });
```

<details>

<summary>This affects the following methods</summary>

- `client.fineTuning.checkpoints.permissions.delete()`
- `client.vectorStores.files.retrieve()`
- `client.vectorStores.files.update()`
- `client.vectorStores.files.delete()`
- `client.vectorStores.files.content()`
- `client.vectorStores.fileBatches.retrieve()`
- `client.vectorStores.fileBatches.cancel()`
- `client.vectorStores.fileBatches.listFiles()`
- `client.beta.threads.runs.retrieve()`
- `client.beta.threads.runs.update()`
- `client.beta.threads.runs.cancel()`
- `client.beta.threads.runs.submitToolOutputs()`
- `client.beta.threads.runs.steps.retrieve()`
- `client.beta.threads.runs.steps.list()`
- `client.beta.threads.messages.retrieve()`
- `client.beta.threads.messages.update()`
- `client.beta.threads.messages.delete()`
- `client.conversations.items.retrieve()`
- `client.conversations.items.delete()`
- `client.evals.runs.retrieve()`
- `client.evals.runs.delete()`
- `client.evals.runs.cancel()`
- `client.evals.runs.outputItems.retrieve()`
- `client.evals.runs.outputItems.list()`
- `client.containers.files.retrieve()`
- `client.containers.files.delete()`
- `client.containers.files.content.retrieve()`

</details>

### URI encoded path parameters

Path params are now properly encoded by default. If you were manually encoding path parameters before giving them to the SDK, you must now stop doing that and pass the
param without any encoding applied.

For example:

```diff
- client.example.retrieve(encodeURIComponent('string/with/slash'))
+ client.example.retrieve('string/with/slash') // retrieves /example/string%2Fwith%2Fslash
```

Previously without the `encodeURIComponent()` call we would have used the path `/example/string/with/slash`; now we'll use `/example/string%2Fwith%2Fslash`.

### Removed request options overloads

When making requests with no required body, query or header parameters, you must now explicitly pass `null`, `undefined` or an empty object `{}` to the params argument in order to customise request options.

```diff
client.example.list();
client.example.list({}, { headers: { ... } });
client.example.list(null, { headers: { ... } });
client.example.list(undefined, { headers: { ... } });
- client.example.list({ headers: { ... } });
+ client.example.list({}, { headers: { ... } });
```

<details>

<summary>This affects the following methods</summary>

- `client.chat.completions.list()`
- `client.chat.completions.messages.list()`
- `client.files.list()`
- `client.fineTuning.jobs.list()`
- `client.fineTuning.jobs.listEvents()`
- `client.fineTuning.jobs.checkpoints.list()`
- `client.fineTuning.checkpoints.permissions.retrieve()`
- `client.vectorStores.list()`
- `client.vectorStores.files.list()`
- `client.beta.chatkit.threads.list()`
- `client.beta.chatkit.threads.listItems()`
- `client.beta.assistants.list()`
- `client.beta.threads.create()`
- `client.beta.threads.runs.list()`
- `client.beta.threads.messages.list()`
- `client.batches.list()`
- `client.responses.retrieve()`
- `client.responses.compact()`
- `client.responses.inputItems.list()`
- `client.responses.inputTokens.count()`
- `client.realtime.calls.reject()`
- `client.conversations.create()`
- `client.conversations.items.list()`
- `client.evals.list()`
- `client.evals.runs.list()`
- `client.containers.list()`
- `client.containers.files.list()`
- `client.videos.list()`
- `client.videos.downloadContent()`

### HTTP method naming

Previously some methods could not be named intuitively due to an internal naming conflict. This has been fixed and the affected methods are now correctly named.

```ts
// Before
client.chat.completions.del();
client.files.del();
client.models.del();
client.fineTuning.checkpoints.permissions.del();
client.vectorStores.del();
client.vectorStores.files.del();
client.beta.assistants.del();
client.beta.threads.del();
client.beta.threads.messages.del();
client.responses.del();
client.evals.del();
client.evals.runs.del();
client.containers.del();
client.containers.files.del();

// After
client.chat.completions.delete();
client.files.delete();
client.models.delete();
client.fineTuning.checkpoints.permissions.delete();
client.vectorStores.delete();
client.vectorStores.files.delete();
client.beta.assistants.delete();
client.beta.threads.delete();
client.beta.threads.messages.delete();
client.responses.delete();
client.evals.delete();
client.evals.runs.delete();
client.containers.delete();
client.containers.files.delete();
```

### Removed `httpAgent` in favor of `fetchOptions`

The `httpAgent` client option has been removed in favor of a [platform-specific `fetchOptions` property](https://github.com/openai/openai-node#fetch-options).
This change was made as `httpAgent` relied on `node:http` agents which are not supported by any runtime's builtin fetch implementation.

If you were using `httpAgent` for proxy support, check out the [new proxy documentation](https://github.com/openai/openai-node#configuring-proxies).

Before:

```ts
import OpenAI from 'openai';
import http from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Configure the default for all requests:
const client = new OpenAI({
  httpAgent: new HttpsProxyAgent(process.env.PROXY_URL),
});
```

After:

```ts
import OpenAI from 'openai';
import * as undici from 'undici';

const proxyAgent = new undici.ProxyAgent(process.env.PROXY_URL);
const client = new OpenAI({
  fetchOptions: {
    dispatcher: proxyAgent,
  },
});
```

### Changed exports

#### Refactor of `openai/core`, `error`, `pagination`, `resource`, `streaming` and `uploads`

Much of the `openai/core` file was intended to be internal-only but it was publicly accessible, as such it has been refactored and split up into internal and public files, with public-facing code moved to a new `core` folder and internal code moving to the private `internal` folder.

At the same time, we moved some public-facing files which were previously at the top level into `core` to make the file structure cleaner and more clear:

```typescript
// Before
import 'openai/error';
import 'openai/pagination';
import 'openai/resource';
import 'openai/streaming';
import 'openai/uploads';

// After
import 'openai/core/error';
import 'openai/core/pagination';
import 'openai/core/resource';
import 'openai/core/streaming';
import 'openai/core/uploads';
```

If you were relying on anything that was only exported from `openai/core` and is also not accessible anywhere else, please open an issue and we'll consider adding it to the public API.

#### Resource classes

Previously under certain circumstances it was possible to import resource classes like `Completions` directly from the root of the package. This was never valid at the type level and only worked in CommonJS files.
Now you must always either reference them as static class properties or import them directly from the files in which they are defined.

```typescript
// Before
const { Completions } = require('openai');

// After
const { OpenAI } = require('openai');
OpenAI.Completions; // or import directly from openai/resources/completions
```

#### Cleaned up `uploads` exports

As part of the `core` refactor, `openai/uploads` was moved to `openai/core/uploads`
and the following exports were removed, as they were not intended to be a part of the public API:

- `fileFromPath`
- `BlobPart`
- `BlobLike`
- `FileLike`
- `ResponseLike`
- `isResponseLike`
- `isBlobLike`
- `isFileLike`
- `isUploadable`
- `isMultipartBody`
- `maybeMultipartFormRequestOptions`
- `multipartFormRequestOptions`
- `createForm`

Note that `Uploadable` & `toFile` **are** still exported:

```typescript
import { type Uploadable, toFile } from 'openai/core/uploads';
```

#### `APIClient`

The `APIClient` base client class has been removed as it is no longer needed. If you were importing this class then you must now import the main client class:

```typescript
// Before
import { APIClient } from 'openai/core';

// After
import { OpenAI } from 'openai';
```

### File handling

The deprecated `fileFromPath` helper has been removed in favor of native Node.js streams:

```ts
// Before
OpenAI.fileFromPath('path/to/file');

// After
import fs from 'fs';
fs.createReadStream('path/to/file');
```

Note that this function previously only worked on Node.js. If you're using Bun, you can use [`Bun.file`](https://bun.sh/docs/api/file-io) instead.

### Shims removal

Previously you could configure the types that the SDK used like this:

```ts
// Tell TypeScript and the package to use the global Web fetch instead of node-fetch.
import 'openai/shims/web';
import OpenAI from 'openai';
```

The `openai/shims` imports have been removed. Your global types must now be [correctly configured](#minimum-types-requirements).

### Zod helpers optionality error

Previously, the following code would just output a warning to the console, now it will throw an error.

```ts
const completion = await client.chat.completions.parse({
  // ...
  response_format: zodResponseFormat(
    z.object({
      optional_property: z.string().optional(),
    }),
    'schema',
  ),
});
```

You must mark optional properties with `.nullable()` as purely optional fields are not supported by the [API](https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required).

```ts
const completion = await client.chat.completions.parse({
  // ...
  response_format: zodResponseFormat(
    z.object({
      optional_property: z.string().optional().nullable(),
    }),
    'schema',
  ),
});
```

### Pagination changes

The `for await` syntax **is not affected**. This still works as-is:

```ts
// Automatically fetches more pages as needed.
for await (const fineTuningJob of client.fineTuning.jobs.list()) {
  console.log(fineTuningJob);
}
```

The interface for manually paginating through list results has been simplified:

```ts
// Before
page.nextPageParams();
page.nextPageInfo();
// Required manually handling { url } | { params } type

// After
page.nextPageRequestOptions();
```

#### Removed unnecessary classes

Page classes for individual methods are now type aliases:

```ts
// Before
export class FineTuningJobsPage extends CursorPage<FineTuningJob> {}

// After
export type FineTuningJobsPage = CursorPage<FineTuningJob>;
```

If you were importing these classes at runtime, you'll need to switch to importing the base class or only import them at the type-level.

### Beta chat namespace removed

The `beta.chat` namespace has been removed. All chat completion methods that were previously in beta have been moved to the main `chat.completions` namespace:

```ts
// Before
client.beta.chat.completions.parse()
client.beta.chat.completions.stream()
client.beta.chat.completions.runTools()

// After
client.chat.completions.parse()
client.chat.completions.stream()
client.chat.completions.runTools()
```

Additionally, related types have been moved:

```ts
// Before
import { ParsedChatCompletion, ParsedChoice, ParsedFunction } from 'openai/resources/beta/chat/completions';

// After
import { ParsedChatCompletion, ParsedChoice, ParsedFunction } from 'openai/resources/chat/completions';
```

### Removed deprecated `.runFunctions` methods

The deprecated `client.chat.completions.runFunctions()` method and all of it's surrounding types have been removed, instead you should use
`client.chat.completions.runTools()`.

### `.runTools()` event / method names

To better align with the tool-based API, several event names in the ChatCompletionRunner have been renamed:

```ts
// Before
openai.chat.completions
  .runTools({
    // ..
  })
  .on('functionCall', (functionCall) => console.log('functionCall', functionCall))
  .on('functionCallResult', (functionCallResult) => console.log('functionCallResult', functionCallResult))
  .on('finalFunctionCall', (functionCall) => console.log('finalFunctionCall', functionCall))
  .on('finalFunctionCallResult', (result) => console.log('finalFunctionCallResult', result));

// After
openai.chat.completions
  .runTools({
    // ..
  })
  .on('functionToolCall', (functionCall) => console.log('functionCall', functionCall))
  .on('functionToolCallResult', (functionCallResult) => console.log('functionCallResult', functionCallResult))
  .on('finalFunctionToolCall', (functionCall) => console.log('finalFunctionCall', functionCall))
  .on('finalFunctionToolCallResult', (result) => console.log('finalFunctionCallResult', result));
```

The following event names have been changed:
- `functionCall` → `functionToolCall`
- `functionCallResult` → `functionToolCallResult`
- `finalFunctionCall` → `finalFunctionToolCall`
- `finalFunctionCallResult` → `finalFunctionToolCallResult`

Additionally, the following methods have been renamed:
- `runner.finalFunctionCall()` → `runner.finalFunctionToolCall()`
- `runner.finalFunctionCallResult()` → `runner.finalFunctionToolCallResult()`

### `openai/src` directory removed

Previously IDEs may have auto-completed imports from the `openai/src` directory, however this
directory was only included for an improved go-to-definition experience and should not have been used at runtime.

If you have any `openai/src/*` imports, you will need to replace them with `openai/*`.

```ts
// Before
import OpenAI from 'openai/src';

// After
import OpenAI from 'openai';
```

## TypeScript troubleshooting

When referencing the library after updating, you may encounter new type errors related to JS features like private properties or fetch classes like Request, Response, and Headers.
To resolve these issues, configure your tsconfig.json and install the appropriate `@types` packages for your runtime environment using the guidelines below:

### Browsers

`tsconfig.json`

```jsonc
{
  "target": "ES2018", // note: we recommend ES2020 or higher
  "lib": ["DOM", "DOM.Iterable", "ES2018"]
}
```

### Node.js

`tsconfig.json`

```jsonc
{
  "target": "ES2018" // note: we recommend ES2020 or higher
}
```

`package.json`

```json
{
  "devDependencies": {
    "@types/node": ">= 20"
  }
}
```

### Cloudflare Workers

`tsconfig.json`

```jsonc
{
  "target": "ES2018", // note: we recommend ES2020 or higher
  "lib": ["ES2020"], // <- needed by @cloudflare/workers-types
  "types": ["@cloudflare/workers-types"]
}
```

`package.json`

```json
{
  "devDependencies": {
    "@cloudflare/workers-types": ">= 0.20221111.0"
  }
}
```

### Bun

`tsconfig.json`

```jsonc
{
  "target": "ES2018" // note: we recommend ES2020 or higher
}
```

`package.json`

```json
{
  "devDependencies": {
    "@types/bun": ">= 1.2.0"
  }
}
```
