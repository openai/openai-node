# Client Configuration

Configure shared behavior on the `OpenAI` client and override supported options for individual
requests.

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
  organization: process.env['OPENAI_ORG_ID'],
  project: process.env['OPENAI_PROJECT_ID'],
  timeout: 30_000,
  maxRetries: 2,
});
```

`OPENAI_API_KEY`, `OPENAI_ADMIN_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_BASE_URL`, and
`OPENAI_WEBHOOK_SECRET` provide defaults for their corresponding client options. For workload identity
or provider-specific credentials, see [Authentication](authentication.md), [Azure](azure.md), and
[Amazon Bedrock](bedrock.md).

## Request options

Pass per-request options as the second argument to a resource method:

```ts
const response = await client.responses.create(
  {
    model: 'gpt-5.5',
    input: 'Summarize the latest status update.',
  },
  {
    timeout: 5_000,
    maxRetries: 0,
    headers: { 'x-correlation-id': 'job-123' },
  },
);
```

Use `defaultHeaders` and `defaultQuery` on the client to apply values to all requests. Per-request
headers and query options can override those defaults.

## Errors

API and connection failures are represented by subclasses of `OpenAI.APIError`:

```ts
try {
  await client.responses.create({ model: 'gpt-5.5', input: 'Hello' });
} catch (error) {
  if (error instanceof OpenAI.APIError) {
    console.error(error.status, error.name, error.requestID);
    throw error;
  }

  throw error;
}
```

| Status        | Error                      |
| ------------- | -------------------------- |
| 400           | `BadRequestError`          |
| 401           | `AuthenticationError`      |
| 403           | `PermissionDeniedError`    |
| 404           | `NotFoundError`            |
| 409           | `ConflictError`            |
| 422           | `UnprocessableEntityError` |
| 429           | `RateLimitError`           |
| 500 or higher | `InternalServerError`      |
| No response   | `APIConnectionError`       |

Timeouts raise `APIConnectionTimeoutError`. An API error exposes its HTTP status, response headers,
parsed error body, and request ID when available. See the [error-handling example](../examples/client/errors.ts).

## Retries and timeouts

The client retries temporary connection errors and HTTP 408, 409, 429, and 500-or-higher responses twice
by default. Configure the normal retry count with `maxRetries`; set it to `0` to disable those retries.
Workload identity may still retry a replayable request once after refreshing credentials for an HTTP 401;
see [Authentication](authentication.md#token-caching-and-refresh).

```ts
const client = new OpenAI({
  maxRetries: 3,
  timeout: 30_000,
});
```

The default request timeout is 10 minutes. A timed-out request can also be retried unless retries are
disabled. Streaming upload bodies have additional replay constraints; see [File uploads](uploads.md).

## Request IDs and raw responses

Parsed API responses expose `_request_id` from the response's `x-request-id` header:

```ts
const result = await client.responses.create({
  model: 'gpt-5.5',
  input: 'Hello',
});

console.log(result._request_id);
```

Use `withResponse()` for both the parsed result and the underlying Web API `Response`:

```ts
const { data, response, request_id } = await client.responses
  .create({ model: 'gpt-5.5', input: 'Hello' })
  .withResponse();

console.log(data.output_text, response.status, request_id);
```

`asResponse()` returns the raw response without consuming its body:

```ts
const response = await client.responses.create({ model: 'gpt-5.5', input: 'Hello' }).asResponse();
```

See the [raw-response example](../examples/client/raw-response.ts).

## Pagination

List methods return pages that can be traversed automatically with async iteration:

```ts
for await (const file of client.files.list()) {
  console.log(file.id);
}
```

For explicit pagination, inspect the current page and call `hasNextPage()` and `getNextPage()`:

```ts
let page = await client.files.list({ limit: 20 });

while (true) {
  for (const file of page.data) console.log(file.id);
  if (!page.hasNextPage()) break;
  page = await page.getNextPage();
}
```

## Logging

Set `OPENAI_LOG` or pass `logLevel` to control diagnostic logging:

```ts
const client = new OpenAI({ logLevel: 'debug' });
```

Supported levels are `debug`, `info`, `warn`, `error`, and `off`; the default is `warn`. A custom
`logger` can forward SDK messages to a logging library:

```ts
import pino from 'pino';

const client = new OpenAI({
  logger: pino().child({ name: 'OpenAI' }),
  logLevel: 'info',
});
```

Debug logging can include request and response bodies. Some authentication headers are redacted, but
sensitive application data in payloads may still be logged. Treat debug logs as sensitive.

## Custom fetch and proxies

Provide a custom `fetch` implementation when the runtime's global implementation is not suitable:

```ts
import fetch from 'my-fetch';

const client = new OpenAI({ fetch });
```

Use `fetchOptions` for implementation-specific request options. In Node.js, pair Undici's `ProxyAgent`
with Undici's own `fetch`:

```ts
import OpenAI from 'openai';
import { fetch, ProxyAgent } from 'undici';

const proxy = new ProxyAgent('http://localhost:8888');

const client = new OpenAI({
  fetch,
  fetchOptions: { dispatcher: proxy },
});
```

Undici-specific options do not apply to unrelated `fetch` implementations. Bun and Deno use their own
runtime-specific proxy options.

## Custom requests

Call `client.get()`, `client.post()`, or another HTTP verb for undocumented endpoints:

```ts
await client.post('/some/path', {
  body: { value: 'example' },
  query: { include: 'details' },
});
```

Client configuration, authentication, retries, and timeouts still apply. Undocumented request and
response properties may require a TypeScript assertion or `@ts-expect-error`.

## Browser safety

Browser usage is disabled by default because shipping a secret API key to client-side code exposes it
to end users. Only set `dangerouslyAllowBrowser: true` when the credential is explicitly safe for that
environment and appropriate mitigations are in place.
