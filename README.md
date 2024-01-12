# OpenAI Node API Library

[![NPM version](https://img.shields.io/npm/v/openai.svg)](https://npmjs.org/package/openai)

This library provides convenient access to the OpenAI REST API from TypeScript or JavaScript.

It is generated from our [OpenAPI specification](https://github.com/openai/openai-openapi) with [Stainless](https://stainlessapi.com/).

To learn how to use the OpenAI API, check out our [API Reference](https://platform.openai.com/docs/api-reference) and [Documentation](https://platform.openai.com/docs).

## Installation

```sh
npm install --save openai
# or
yarn add openai
```

You can import in Deno via:

<!-- x-release-please-start-version -->

```ts
import OpenAI from 'https://deno.land/x/openai@v4.24.5/mod.ts';
```

<!-- x-release-please-end -->

## Usage

The full API of this library can be found in [api.md file](api.md) along with many [code examples](https://github.com/openai/openai-node/tree/master/examples). The code below shows how to get started using the chat completions API.

<!-- prettier-ignore -->
```js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

async function main() {
  const chatCompletion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: 'Say this is a test' }],
    model: 'gpt-3.5-turbo',
  });
}

main();
```

## Streaming Responses

We provide support for streaming responses using Server Sent Events (SSE).

```ts
import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test' }],
    stream: true,
  });
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main();
```

If you need to cancel a stream, you can `break` from the loop
or call `stream.controller.abort()`.

### Request & Response types

This library includes TypeScript definitions for all request params and response fields. You may import and use them like so:

<!-- prettier-ignore -->
```ts
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

async function main() {
  const params: OpenAI.Chat.ChatCompletionCreateParams = {
    messages: [{ role: 'user', content: 'Say this is a test' }],
    model: 'gpt-3.5-turbo',
  };
  const chatCompletion: OpenAI.Chat.ChatCompletion = await openai.chat.completions.create(params);
}

main();
```

Documentation for each method, request param, and response field are available in docstrings and will appear on hover in most modern editors.

> [!IMPORTANT]
> Previous versions of this SDK used a `Configuration` class. See the [v3 to v4 migration guide](https://github.com/openai/openai-node/discussions/217).

### Streaming responses

This library provides several conveniences for streaming chat completions, for example:

```ts
import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const stream = await openai.beta.chat.completions.stream({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Say this is a test' }],
    stream: true,
  });

  stream.on('content', (delta, snapshot) => {
    process.stdout.write(delta);
  });

  // or, equivalently:
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }

  const chatCompletion = await stream.finalChatCompletion();
  console.log(chatCompletion); // {id: "…", choices: […], …}
}

main();
```

Streaming with `openai.beta.chat.completions.stream({…})` exposes
[various helpers for your convenience](helpers.md#events) including event handlers and promises.

Alternatively, you can use `openai.chat.completions.create({ stream: true, … })`
which only returns an async iterable of the chunks in the stream and thus uses less memory
(it does not build up a final chat completion object for you).

If you need to cancel a stream, you can `break` from a `for await` loop or call `stream.abort()`.

### Automated function calls

We provide the `openai.beta.chat.completions.runTools({…})`
convenience helper for using function tool calls with the `/chat/completions` endpoint
which automatically call the JavaScript functions you provide
and sends their results back to the `/chat/completions` endpoint,
looping as long as the model requests tool calls.

If you pass a `parse` function, it will automatically parse the `arguments` for you
and returns any parsing errors to the model to attempt auto-recovery.
Otherwise, the args will be passed to the function you provide as a string.

If you pass `tool_choice: {function: {name: …}}` instead of `auto`,
it returns immediately after calling that function (and only loops to auto-recover parsing errors).

```ts
import OpenAI from 'openai';

const client = new OpenAI();

async function main() {
  const runner = client.beta.chat.completions
    .runTools({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'How is the weather this week?' }],
      tools: [
        {
          type: 'function',
          function: {
            function: getCurrentLocation,
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function',
          function: {
            function: getWeather,
            parse: JSON.parse, // or use a validation library like zod for typesafe parsing.
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        },
      ],
    })
    .on('message', (message) => console.log(message));

  const finalContent = await runner.finalContent();
  console.log();
  console.log('Final content:', finalContent);
}

async function getCurrentLocation() {
  return 'Boston'; // Simulate lookup
}

async function getWeather(args: { location: string }) {
  const { location } = args;
  // … do lookup …
  return { temperature, precipitation };
}

main();

// {role: "user",      content: "How's the weather this week?"}
// {role: "assistant", tool_calls: [{type: "function", function: {name: "getCurrentLocation", arguments: "{}"}, id: "123"}
// {role: "tool",      name: "getCurrentLocation", content: "Boston", tool_call_id: "123"}
// {role: "assistant", tool_calls: [{type: "function", function: {name: "getWeather", arguments: '{"location": "Boston"}'}, id: "1234"}]}
// {role: "tool",      name: "getWeather", content: '{"temperature": "50degF", "preciptation": "high"}', tool_call_id: "1234"}
// {role: "assistant", content: "It's looking cold and rainy - you might want to wear a jacket!"}
//
// Final content: "It's looking cold and rainy - you might want to wear a jacket!"
```

Like with `.stream()`, we provide a variety of [helpers and events](helpers.md#events).

Note that `runFunctions` was previously available as well, but has been deprecated in favor of `runTools`.

Read more about various examples such as with integrating with [zod](helpers.md#integrate-with-zod),
[next.js](helpers.md#integrate-wtih-next-js), and [proxying a stream to the browser](helpers.md#proxy-streaming-to-a-browser).

## File Uploads

Request parameters that correspond to file uploads can be passed in many different forms:

- `File` (or an object with the same structure)
- a `fetch` `Response` (or an object with the same structure)
- an `fs.ReadStream`
- the return value of our `toFile` helper

```ts
import fs from 'fs';
import fetch from 'node-fetch';
import OpenAI, { toFile } from 'openai';

const openai = new OpenAI();

// If you have access to Node `fs` we recommend using `fs.createReadStream()`:
await openai.files.create({ file: fs.createReadStream('input.jsonl'), purpose: 'fine-tune' });

// Or if you have the web `File` API you can pass a `File` instance:
await openai.files.create({ file: new File(['my bytes'], 'input.jsonl'), purpose: 'fine-tune' });

// You can also pass a `fetch` `Response`:
await openai.files.create({ file: await fetch('https://somesite/input.jsonl'), purpose: 'fine-tune' });

// Finally, if none of the above are convenient, you can use our `toFile` helper:
await openai.files.create({
  file: await toFile(Buffer.from('my bytes'), 'input.jsonl'),
  purpose: 'fine-tune',
});
await openai.files.create({
  file: await toFile(new Uint8Array([0, 1, 2]), 'input.jsonl'),
  purpose: 'fine-tune',
});
```

## Handling errors

When the library is unable to connect to the API,
or if the API returns a non-success status code (i.e., 4xx or 5xx response),
a subclass of `APIError` will be thrown:

<!-- prettier-ignore -->
```ts
async function main() {
  const job = await openai.fineTuning.jobs
    .create({ model: 'gpt-3.5-turbo', training_file: 'file-abc123' })
    .catch((err) => {
      if (err instanceof OpenAI.APIError) {
        console.log(err.status); // 400
        console.log(err.name); // BadRequestError
        console.log(err.headers); // {server: 'nginx', ...}
      } else {
        throw err;
      }
    });
}

main();
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

### Azure OpenAI

An example of using this library with Azure OpenAI can be found [here](https://github.com/openai/openai-node/blob/master/examples/azure.ts).

Please note there are subtle differences in API shape & behavior between the Azure OpenAI API and the OpenAI API,
so using this library with Azure OpenAI may result in incorrect types, which can lead to bugs.

See [`@azure/openai`](https://www.npmjs.com/package/@azure/openai) for an Azure-specific SDK provided by Microsoft.

### Retries

Certain errors will be automatically retried 2 times by default, with a short exponential backoff.
Connection errors (for example, due to a network connectivity problem), 408 Request Timeout, 409 Conflict,
429 Rate Limit, and >=500 Internal errors will all be retried by default.

You can use the `maxRetries` option to configure or disable this:

<!-- prettier-ignore -->
```js
// Configure the default for all requests:
const openai = new OpenAI({
  maxRetries: 0, // default is 2
});

// Or, configure per-request:
await openai.chat.completions.create({ messages: [{ role: 'user', content: 'How can I get the name of the current day in Node.js?' }], model: 'gpt-3.5-turbo' }, {
  maxRetries: 5,
});
```

### Timeouts

Requests time out after 10 minutes by default. You can configure this with a `timeout` option:

<!-- prettier-ignore -->
```ts
// Configure the default for all requests:
const openai = new OpenAI({
  timeout: 20 * 1000, // 20 seconds (default is 10 minutes)
});

// Override per-request:
await openai.chat.completions.create({ messages: [{ role: 'user', content: 'How can I list all files in a directory using Python?' }], model: 'gpt-3.5-turbo' }, {
  timeout: 5 * 1000,
});
```

On timeout, an `APIConnectionTimeoutError` is thrown.

Note that requests which time out will be [retried twice by default](#retries).

## Auto-pagination

List methods in the OpenAI API are paginated.
You can use `for await … of` syntax to iterate through items across all pages:

```ts
async function fetchAllFineTuningJobs(params) {
  const allFineTuningJobs = [];
  // Automatically fetches more pages as needed.
  for await (const fineTuningJob of openai.fineTuning.jobs.list({ limit: 20 })) {
    allFineTuningJobs.push(fineTuningJob);
  }
  return allFineTuningJobs;
}
```

Alternatively, you can make request a single page at a time:

```ts
let page = await openai.fineTuning.jobs.list({ limit: 20 });
for (const fineTuningJob of page.data) {
  console.log(fineTuningJob);
}

// Convenience methods are provided for manually paginating:
while (page.hasNextPage()) {
  page = page.getNextPage();
  // ...
}
```

## Advanced Usage

### Accessing raw Response data (e.g., headers)

The "raw" `Response` returned by `fetch()` can be accessed through the `.asResponse()` method on the `APIPromise` type that all methods return.

You can also use the `.withResponse()` method to get the raw `Response` along with the parsed data.

<!-- prettier-ignore -->
```ts
const openai = new OpenAI();

const response = await openai.chat.completions
  .create({ messages: [{ role: 'user', content: 'Say this is a test' }], model: 'gpt-3.5-turbo' })
  .asResponse();
console.log(response.headers.get('X-My-Header'));
console.log(response.statusText); // access the underlying Response object

const { data: chatCompletion, response: raw } = await openai.chat.completions
  .create({ messages: [{ role: 'user', content: 'Say this is a test' }], model: 'gpt-3.5-turbo' })
  .withResponse();
console.log(raw.headers.get('X-My-Header'));
console.log(chatCompletion);
```

## Customizing the fetch client

By default, this library uses `node-fetch` in Node, and expects a global `fetch` function in other environments.

If you would prefer to use a global, web-standards-compliant `fetch` function even in a Node environment,
(for example, if you are running Node with `--experimental-fetch` or using NextJS which polyfills with `undici`),
add the following import before your first import `from "OpenAI"`:

```ts
// Tell TypeScript and the package to use the global web fetch instead of node-fetch.
// Note, despite the name, this does not add any polyfills, but expects them to be provided if needed.
import 'openai/shims/web';
import OpenAI from 'openai';
```

To do the inverse, add `import "openai/shims/node"` (which does import polyfills).
This can also be useful if you are getting the wrong TypeScript types for `Response` - more details [here](https://github.com/openai/openai-node/tree/master/src/_shims#readme).

You may also provide a custom `fetch` function when instantiating the client,
which can be used to inspect or alter the `Request` or `Response` before/after each request:

```ts
import { fetch } from 'undici'; // as one example
import OpenAI from 'openai';

const client = new OpenAI({
  fetch: async (url: RequestInfo, init?: RequestInfo): <Response> => {
    console.log('About to make request', url, init);
    const response = await fetch(url, init);
    console.log('Got response', response);
    return response;
  },
});
```

Note that if given a `DEBUG=true` environment variable, this library will log all requests and responses automatically.
This is intended for debugging purposes only and may change in the future without notice.

## Configuring an HTTP(S) Agent (e.g., for proxies)

By default, this library uses a stable agent for all http/https requests to reuse TCP connections, eliminating many TCP & TLS handshakes and shaving around 100ms off most requests.

If you would like to disable or customize this behavior, for example to use the API behind a proxy, you can pass an `httpAgent` which is used for all requests (be they http or https), for example:

<!-- prettier-ignore -->
```ts
import http from 'http';
import HttpsProxyAgent from 'https-proxy-agent';

// Configure the default for all requests:
const openai = new OpenAI({
  httpAgent: new HttpsProxyAgent(process.env.PROXY_URL),
});

// Override per-request:
await openai.models.list({
  baseURL: 'http://localhost:8080/test-api',
  httpAgent: new http.Agent({ keepAlive: false }),
})
```

## Semantic Versioning

This package generally follows [SemVer](https://semver.org/spec/v2.0.0.html) conventions, though certain backwards-incompatible changes may be released as minor versions:

1. Changes that only affect static types, without breaking runtime behavior.
2. Changes to library internals which are technically public but not intended or documented for external use. _(Please open a GitHub issue to let us know if you are relying on such internals)_.
3. Changes that we do not expect to impact the vast majority of users in practice.

We take backwards-compatibility seriously and work hard to ensure you can rely on a smooth upgrade experience.

We are keen for your feedback; please open an [issue](https://www.github.com/openai/openai-node/issues) with questions, bugs, or suggestions.

## Requirements

TypeScript >= 4.5 is supported.

The following runtimes are supported:

- Node.js 18 LTS or later ([non-EOL](https://endoflife.date/nodejs)) versions.
- Deno v1.28.0 or higher, using `import OpenAI from "npm:openai"`.
- Bun 1.0 or later.
- Cloudflare Workers.
- Vercel Edge Runtime.
- Jest 28 or greater with the `"node"` environment (`"jsdom"` is not supported at this time).
- Nitro v2.6 or greater.

Note that React Native is not supported at this time.

If you are interested in other runtime environments, please open or upvote an issue on GitHub.
