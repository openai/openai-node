# Migration guide

This guide outlines the changes and steps needed to migrate your codebase to the latest version of the OpenAI TypeScript and JavaScript SDK.

The main changes are that the SDK now relies on the [builtin Web fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) instead of `node-fetch` and has zero dependencies.

## Environment requirements

The minimum supported runtime and tooling versions are now:

- Node.js 18.x last LTS (Required for built-in fetch support)
  - This was previously documented as the minimum supported Node.js version but Node.js 16.x mostly worked at runtime; now it will not.
- TypeScript 4.9
- Jest 28

## Minimum types requirements

### DOM

`tsconfig.json`

```jsonc
{
  "target": "ES2015", // note: we recommend ES2020 or higher
  "lib": ["DOM", "DOM.Iterable", "ES2018"]
}
```

### Node.js

`tsconfig.json`

```jsonc
{
  "target": "ES2015" // note: we recommend ES2020 or higher
}
```

`package.json`

```json
{
  "devDependencies": {
    "@types/node": ">= 18.18.7"
  }
}
```

### Cloudflare Workers

`tsconfig.json`

```jsonc
{
  "target": "ES2015", // note: we recommend ES2020 or higher
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
  "target": "ES2015" // note: we recommend ES2020 or higher
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

### Deno

No config needed!

## Breaking changes

### Named path parameters

Methods that take multiple path parameters typically now use named instead of positional arguments for better clarity and to prevent a footgun where it was easy to accidentally pass arguments in the incorrect order.

For example, for a method that would call an endpoint at `/v1/parents/{parent_id}/children/{child_id}`, only the _last_ path parameter is positional and the rest must be passed as named arguments.

```ts
// Before
client.parents.children.create('p_123', 'c_456');

// After
client.example.create('c_456', { parent_id: 'p_123' });
```

This affects the following methods:

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

### URI encoded path parameters

Path params are now properly encoded by default. If you were manually encoding path parameters before giving them to the SDK, you must now stop doing that and pass the
param without any encoding applied.

For example:

```diff
- client.example.retrieve(encodeURIComponent('string/with/slash'))
+ client.example.retrieve('string/with/slash') // renders example/string%2Fwith%2Fslash
```

Previously without the `encodeURIComponent()` call we would have used the path `/example/string/with/slash`; now we'll use `/example/string%2Fwith%2Fslash`.

### Removed `httpAgent` in favor of `fetchOptions`

The `httpAgent` client option has been removed in favor of a [platform-specific `fetchOptions` property](https://github.com/stainless-sdks/openai-typescript#fetch-options).
This change was made as `httpAgent` relied on `node:http` agents which are not supported by any runtime's builtin fetch implementation.

If you were using `httpAgent` for proxy support, check out the [new proxy documentation](https://github.com/stainless-sdks/openai-typescript#configuring-proxies).

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

### HTTP method naming

Some methods could not be named intuitively due to an internal naming conflict. This has been resolved and the methods are now correctly named.

```ts
// Before
client.chat.completions.del();
client.files.del();
client.models.del();
client.vectorStores.del();
client.vectorStores.files.del();
client.beta.assistants.del();
client.beta.threads.del();
client.beta.threads.messages.del();
client.responses.del();

// After
client.chat.completions.delete();
client.files.delete();
client.models.delete();
client.vectorStores.delete();
client.vectorStores.files.delete();
client.beta.assistants.delete();
client.beta.threads.delete();
client.beta.threads.messages.delete();
client.responses.delete();
```

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

This affects the following methods:

- `client.chat.completions.list()`
- `client.chat.completions.messages.list()`
- `client.files.list()`
- `client.fineTuning.jobs.list()`
- `client.fineTuning.jobs.listEvents()`
- `client.fineTuning.jobs.checkpoints.list()`
- `client.vectorStores.list()`
- `client.vectorStores.files.list()`
- `client.beta.assistants.list()`
- `client.beta.threads.create()`
- `client.beta.threads.runs.list()`
- `client.beta.threads.messages.list()`
- `client.batches.list()`
- `client.responses.retrieve()`
- `client.responses.inputItems.list()`

### Pagination changes

Note that the `for await` syntax is _not_ affected. This still works as-is:

```ts
// Automatically fetches more pages as needed.
for await (const fineTuningJob of client.fineTuning.jobs.list()) {
  console.log(fineTuningJob);
}
```

#### Simplified interface

The pagination interface has been simplified:

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

### `openai/src` directory removed

Previously IDEs may have auto-completed imports from the `openai/src` directory, however this
directory was only included for an improved go-to-definition experience and should not have been used at runtime.

If you have any `openai/src` imports, you must replace it with `openai`.

```ts
// Before
import OpenAI from 'openai/src';

// After
import OpenAI from 'openai';
```

### Headers

The `headers` property on `APIError` objects is now an instance of the Web [Headers](https://developer.mozilla.org/en-US/docs/Web/API/Headers) class. It was previously just `Record<string, string | null | undefined>`.

### Removed exports

#### `Response`

```typescript
// Before
import { Response } from 'openai';

// After
// `Response` must now come from the builtin types
```

#### Resource classes

If you were importing resource classes from the root package then you must now import them from the file they are defined in:

```typescript
// Before
import { Completions } from 'openai';

// After
import { Completions } from 'openai/resources/completions';
```

#### `openai/core`

The `openai/core` file was intended to be internal-only but it was publicly accessible, as such it has been refactored and split up into internal files.

If you were relying on anything that was only exported from `openai/core` and is also not accessible anywhere else, please open an issue and we'll consider adding it to the public API.

#### `APIClient`

The `APIClient` base client class has been removed as it is no longer needed. If you were importing this class then you must now import the main client class:

```typescript
// Before
import { APIClient } from 'openai/core';

// After
import { OpenAI } from 'openai';
```

#### Cleaned up `openai/uploads` exports

The following exports have been removed from `openai/uploads` as they were not intended to be a part of the public API:

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
import { type Uploadable, toFile } from 'openai/uploads';
```
