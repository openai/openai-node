# OpenAI Node API Library

[![NPM version](https://img.shields.io/npm/v/openai.svg)](https://npmjs.org/package/openai)

The OpenAI Node library provides convenient access to the OpenAI REST API from applications written in server-side JavaScript.
It includes TypeScript definitions for all request params and response fields.

> ⚠️ **Important note: this library is meant for server-side usage only, as using it in client-side browser code will expose your secret API key. [See here](https://platform.openai.com/docs/api-reference/authentication) for more details.**

## Documentation

To learn how to use the OpenAI API, check out our [API Reference](https://platform.openai.com/docs/api-reference) and [Documentation](https://platform.openai.com/docs).

## Installation

```sh
npm install --save openai
# or
yarn add openai
```

## Usage

```js
import OpenAI from 'openai';

const openAI = new OpenAI({
  apiKey: 'my api key', // defaults to process.env["OPENAI_API_KEY"]
});

async function main() {
  const completion = await openAI.completions.create({
    model: 'text-davinci-002',
    prompt: 'Say this is a test',
    max_tokens: 6,
    temperature: 0,
  });

  console.log(completion.choices);
}
main().catch(console.error);
```

## Streaming Responses

We provide support for streaming responses using Server Side Events (SSE).

```ts
import OpenAI from 'openai';

const client = new OpenAI();

const stream = await client.completions.create({
  prompt: 'Say this is a test',
  model: 'text-davinci-003',
  stream: true,
});
for await (const part of stream) {
  process.stdout.write(part.choices[0]?.text || '');
}
```

If you need to cancel a stream, you can `break` from the loop
or call `stream.controller.abort()`.

### Usage with TypeScript

Importing, instantiating, and interacting with the library are the same as above.
If you like, you may reference our types directly:

```ts
import OpenAI from 'openai';

const openAI = new OpenAI({
  apiKey: 'my api key', // defaults to process.env["OPENAI_API_KEY"]
});

async function main() {
  const params: OpenAI.CompletionCreateParams = {
    model: 'text-davinci-002',
    prompt: 'Say this is a test',
    max_tokens: 6,
    temperature: 0,
  };
  const completion: OpenAI.Completion = await openAI.completions.create(params);
}
main().catch(console.error);
```

Documentation for each method, request param, and response field are available in docstrings and will appear on hover in most modern editors.

## File Uploads

Request parameters that correspond to file uploads can be passed as either a `FormData.Blob` or a `FormData.File` instance.

We provide a `fileFromPath` helper function to easily create `FormData.File` instances from a given class.

```ts
import OpenAI, { fileFromPath } from 'openai';

const openAI = new OpenAI();

const file = await fileFromPath('input.jsonl');
await openAI.files.create({ file: file, purpose: 'fine-tune' });
```

## Handling errors

When the library is unable to connect to the API,
or if the API returns a non-success status code (i.e., 4xx or 5xx response),
a subclass of `APIError` will be thrown:

```ts
async function main() {
  const fineTune = await openAI.fineTunes
    .create({ training_file: 'file-XGinujblHPwGLSztz8cPS8XY' })
    .catch((err) => {
      if (err instanceof OpenAI.APIError) {
        console.log(err.status); // 400
        console.log(err.name); // BadRequestError

        console.log(err.headers); // {server: 'nginx', ...}
      }
    });
}
main().catch(console.error);
```

Error codes are as followed:

| Status Code | Error Type                 |
| ----------- | -------------------------- |
| 400         | `BadRequestError`          |
| 401         | `AuthenticationError`      |
| 403         | `PermissionDeniedError`    |
| 404         | `NotFoundError`            |
| 422         | `UnprocessableEntityError` |
| 429         | `RateLimitError`           |
| >=500       | `InternalServerError`      |
| N/A         | `APIConnectionError`       |

### Retries

Certain errors will be automatically retried 2 times by default, with a short exponential backoff.
Connection errors (for example, due to a network connectivity problem), 409 Conflict, 429 Rate Limit,
and >=500 Internal errors will all be retried by default.

You can use the `maxRetries` option to configure or disable this:

<!-- prettier-ignore -->
```js
// Configure the default for all requests:
const openAI = new OpenAI({
  maxRetries: 0, // default is 2
});

// Or, configure per-request:
openAI.embeddings.create({ model: 'text-similarity-babbage-001',input: 'The food was delicious and the waiter...' }, {
  maxRetries: 5,
});
```

### Timeouts

Requests time out after 60 seconds by default. You can configure this with a `timeout` option:

<!-- prettier-ignore -->
```ts
// Configure the default for all requests:
const openAI = new OpenAI({
  timeout: 20 * 1000, // 20 seconds (default is 60s)
});

// Override per-request:
openAI.edits.create({ model: 'text-davinci-edit-001',input: 'What day of the wek is it?',instruction: 'Fix the spelling mistakes' }, {
  timeout: 5 * 1000,
});
```

On timeout, an `APIConnectionTimeoutError` is thrown.

Note that requests which time out will be [retried twice by default](#retries).

## Configuring an HTTP(S) Agent (e.g., for proxies)

By default, this library uses a stable agent for all http/https requests to reuse TCP connections, eliminating many TCP & TLS handshakes and shaving around 100ms off most requests.

If you would like to disable or customize this behavior, for example to use the API behind a proxy, you can pass an `httpAgent` which is used for all requests (be they http or https), for example:

<!-- prettier-ignore -->
```ts
import http from 'http';
import HttpsProxyAgent from 'https-proxy-agent';

// Configure the default for all requests:
const openAI = new OpenAI({
  httpAgent: new HttpsProxyAgent(process.env.PROXY_URL),
});

// Override per-request:
openAI.models.list({
  baseURL: 'http://localhost:8080/test-api',
  httpAgent: new http.Agent({ keepAlive: false }),
})
```

## Status

This package is in beta. Its internals and interfaces are not stable
and subject to change without a major semver bump;
please reach out if you rely on any undocumented behavior.

We are keen for your feedback; please open an [issue](https://www.github.com/openai/openai-node/issues) with questions, bugs, or suggestions.

## Requirements

The following runtimes are supported:

- Node.js version 12 or higher.
- Deno v1.28.0 or higher (experimental).
  Use `import OpenAI from "npm:openai"`.

If you are interested in other runtime environments, please open or upvote an issue on GitHub.
