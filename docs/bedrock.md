# Amazon Bedrock

To use this library with [Amazon Bedrock's OpenAI-compatible API](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html), configure the standard `OpenAI` client with the Bedrock provider:

```ts
import OpenAI from 'openai';
import { bedrock } from 'openai/providers/bedrock/aws';

const client = new OpenAI({
  provider: bedrock({ region: 'us-west-2' }),
});

const response = await client.responses.create({
  model: 'openai.gpt-5.4',
  input: 'Say hello!',
});

console.log(response.output_text);
```

Use a model that [supports the Responses API](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html). A model returned by the Models API may support a different Bedrock inference API instead.

## Endpoints

The `endpoint` option selects which regional Bedrock endpoint to use:

| `endpoint`           | Default API root                                         | SigV4 signing service |
| -------------------- | -------------------------------------------------------- | --------------------- |
| `'mantle'` (default) | `https://bedrock-mantle.<region>.api.aws/openai/v1`      | `bedrock-mantle`      |
| `'runtime'`          | Regional Runtime hostname for the region's AWS partition | `bedrock`             |

Both endpoint modes expose the normal SDK resources, but that does not mean AWS supports every resource on both endpoints. AWS controls the available models, inference profiles, API routes, authentication methods, and streaming behavior for each deployment; unsupported calls surface the provider's normal HTTP errors through the SDK.

The region defaults to `AWS_REGION` or `AWS_DEFAULT_REGION`. Pass `baseURL` or set `AWS_BEDROCK_BASE_URL` to override the derived endpoint. If `endpoint` is omitted, recognized canonical AWS hostnames—including Runtime FIPS and dual-stack variants—automatically select their endpoint family and signing service; otherwise Mantle remains the default. Official FIPS and dual-stack endpoint overrides must use HTTPS and match the configured region. When signing requests sent to a custom or proxy host, explicitly set `endpoint` so the SDK can select the correct SigV4 signing service:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    endpoint: 'mantle',
    baseURL: 'https://bedrock.example.com/openai/v1',
  }),
});
```

Bedrock credentials are sent only to the configured API-root origin; absolute resource URLs targeting a different origin are rejected.

### Amazon Bedrock Runtime

Set `endpoint: 'runtime'` to use the Bedrock Runtime endpoint. The SDK derives the AWS partition DNS suffix from the region (for example, `amazonaws.com` for `us-west-2` and `amazonaws.eu` for `eusc-de-east-1`). The OpenAI inference-profile identifiers include `us.openai.gpt-5.6-sol`, `us.openai.gpt-5.6-terra`, and `us.openai.gpt-5.6-luna`; availability depends on your AWS account and region.

For these inference profiles, the verified integration is non-streaming Chat Completions at `/openai/v1/chat/completions`, authenticated with AWS SigV4 signing service `bedrock`. Set `apiKey: null` to prevent an environment bearer token from taking precedence over your AWS credentials:

```ts
import OpenAI from 'openai';
import { bedrock } from 'openai/providers/bedrock/aws';

const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    endpoint: 'runtime',
    apiKey: null,
  }),
});

const completion = await client.chat.completions.create({
  model: 'us.openai.gpt-5.6-sol',
  messages: [{ role: 'user', content: 'Say hello from Amazon Bedrock Runtime!' }],
});

console.log(completion.choices[0]?.message.content);
```

The SDK can send streaming requests to the same Chat Completions API. Streaming support for a particular Runtime deployment, model, and inference profile has not been live-verified and depends on AWS:

```ts
const stream = await client.chat.completions.create({
  model: 'us.openai.gpt-5.6-sol',
  messages: [{ role: 'user', content: 'Say hello from Amazon Bedrock Runtime!' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

The SDK defaults to the `/openai/v1` route described in [AWS's OpenAI model documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html). [AWS's Chat Completions documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html) instead describes a `/v1` route for Bedrock Runtime. If your model or endpoint requires that route, override the API root explicitly:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    endpoint: 'runtime',
    baseURL: 'https://bedrock-runtime.us-west-2.amazonaws.com/v1',
  }),
});
```

AWS controls which route and authentication method your selected model, inference profile, and endpoint accept. Although the SDK can configure bearer authentication and send Runtime Responses requests, those Runtime capabilities have not been live-verified for these inference profiles. Consult the applicable AWS documentation if a request or credential type is rejected.

## Authentication

The Bedrock provider can configure bearer authentication and AWS SigV4 authentication for both Mantle and Runtime endpoints. AWS determines which authentication methods a deployment accepts; Runtime bearer authentication for the OpenAI inference profiles has not been live-verified. The AWS entrypoint selects authentication in this order:

1. One explicit mode passed to `bedrock(...)`: `apiKey` or `tokenProvider`, static AWS credentials, `profile`, or `credentialProvider`.
2. The [Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) in `AWS_BEARER_TOKEN_BEDROCK`.
3. The default AWS credential chain.

Explicit bearer and AWS credential modes are mutually exclusive. Similarly, configure only one AWS credential mode at a time.

An expired or stale `AWS_BEARER_TOKEN_BEDROCK` takes precedence over the implicit default AWS credential chain and can shadow otherwise valid AWS credentials. Unset `AWS_BEARER_TOKEN_BEDROCK`, or pass `apiKey: null` to disable the environment bearer fallback and force SigV4 authentication with the default AWS credential chain:

```ts
import OpenAI from 'openai';
import { bedrock } from 'openai/providers/bedrock/aws';

const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    endpoint: 'runtime',
    apiKey: null,
  }),
});
```

You can also combine `apiKey: null` with `profile: 'my-profile'` to select a named AWS credential profile explicitly.

### Bearer authentication

Pass a Bedrock API key directly, set `AWS_BEARER_TOKEN_BEDROCK`, or use `tokenProvider` to resolve a fresh token before every request attempt:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    apiKey: process.env['BEDROCK_API_KEY'],
  }),
});
```

For a refreshable bearer credential:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    tokenProvider: async () => refreshBedrockToken(),
  }),
});
```

Bearer authentication does not require any additional dependencies when imported from the dependency-free entrypoint:

```ts
import { bedrock } from 'openai/providers/bedrock';

const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    endpoint: 'runtime',
    apiKey: process.env['AWS_BEARER_TOKEN_BEDROCK'],
  }),
});
```

The dependency-free entrypoint supports only `apiKey`, `tokenProvider`, and `AWS_BEARER_TOKEN_BEDROCK`. Use the AWS entrypoint for SigV4 authentication.

### AWS credentials and SigV4

Install the AWS entrypoint's peer dependencies to sign requests with SigV4:

```sh
npm install @aws-sdk/credential-provider-node @smithy/hash-node @smithy/signature-v4
```

The AWS entrypoint uses normal static imports so Vite, Webpack, and serverless packagers can include these dependencies. If one is missing, importing `openai/providers/bedrock/aws` fails immediately with the runtime's normal module-not-found error, for example:

```text
Cannot find module '@aws-sdk/credential-provider-node'
```

Import the AWS entrypoint, then omit explicit authentication to use the default AWS credential chain or select a shared-config profile:

```ts
import { bedrock } from 'openai/providers/bedrock/aws';

const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    endpoint: 'runtime',
    apiKey: null,
    profile: 'my-profile',
  }),
});
```

Runtime requests are signed for the `bedrock` service, while Mantle requests are signed for `bedrock-mantle`. Explicitly set `endpoint` when `baseURL` or `AWS_BEDROCK_BASE_URL` points to a custom or proxy host so the signing service is unambiguous.

Pass temporary AWS credentials directly, including the session token:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
    sessionToken: process.env['AWS_SESSION_TOKEN'],
  }),
});
```

For credentials that can change, pass a provider. It is called before every request attempt, including retries:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    credentialProvider: async () => ({
      accessKeyId: process.env['AWS_ACCESS_KEY_ID']!,
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY']!,
      sessionToken: process.env['AWS_SESSION_TOKEN'],
    }),
  }),
});
```

SigV4 authentication is supported in Node.js and compatible server runtimes. Bearer authentication can be used in other runtimes without loading the AWS packages by importing from `openai/providers/bedrock`.

The SDK's current SigV4 mode requires a replayable, buffered body such as a string, `ArrayBuffer`, or typed-array view. The standard JSON API methods already meet this requirement. Custom `FormData`, readable streams, and other non-replayable request bodies are rejected before sending; response streaming is unaffected. Signed requests also do not automatically follow redirects, because the redirect target would require a new signature.

Bedrock Mantle also supports `UNSIGNED-PAYLOAD` and AWS-chunked request signing, but this SDK does not enable those modes. Mantle waits for the complete request body before authentication and authorization, so streaming a request body does not reduce request latency.

## Legacy `BedrockOpenAI` class

The `BedrockOpenAI` class remains available for existing bearer-authenticated applications. It accepts the `awsRegion` and `bedrockTokenProvider` option names and defaults to the Mantle `/openai/v1` endpoint:

```ts
import { BedrockOpenAI } from 'openai';

const client = new BedrockOpenAI({
  awsRegion: 'us-west-2',
  apiKey: process.env['AWS_BEARER_TOKEN_BEDROCK'],
});
```

New applications using AWS credentials should prefer `new OpenAI({ provider: bedrock(...) })` with the `openai/providers/bedrock/aws` entrypoint.
