# Amazon Bedrock

To use this library with [Amazon Bedrock's OpenAI-compatible API](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html), configure the standard `OpenAI` client with the Bedrock provider:

```ts
import OpenAI from 'openai';
import { bedrock } from 'openai/providers/bedrock';

const client = new OpenAI({
  provider: bedrock({ region: 'us-west-2' }),
});

const response = await client.responses.create({
  model: 'openai.gpt-5.4',
  input: 'Say hello!',
});

console.log(response.output_text);
```

The provider uses the regional `https://bedrock-mantle.<region>.api.aws/openai/v1` endpoint and the normal SDK resources. AWS controls which endpoints and features are supported; unsupported calls surface the provider's normal HTTP errors through the SDK.

The region defaults to `AWS_REGION` or `AWS_DEFAULT_REGION`. Pass `baseURL` or set `AWS_BEDROCK_BASE_URL` to override the derived endpoint:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    baseURL: 'https://bedrock.example.com/openai/v1',
  }),
});
```

## Authentication

The provider selects authentication in this order:

1. One explicit mode passed to `bedrock(...)`: `apiKey` or `tokenProvider`, static AWS credentials, `profile`, or `credentialProvider`.
2. The [Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) in `AWS_BEARER_TOKEN_BEDROCK`.
3. The default AWS credential chain.

Explicit bearer and AWS credential modes are mutually exclusive. Similarly, configure only one AWS credential mode at a time.

### Bearer authentication

Pass a Bedrock API key directly, set `AWS_BEARER_TOKEN_BEDROCK`, or use `tokenProvider` to resolve a fresh token before every request attempt:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    tokenProvider: async () => refreshBedrockToken(),
  }),
});
```

Bearer authentication does not require any additional dependencies. Pass `apiKey: null` to skip an ambient `AWS_BEARER_TOKEN_BEDROCK` and explicitly select the default AWS credential chain:

```ts
const client = new OpenAI({
  provider: bedrock({ region: 'us-west-2', apiKey: null }),
});
```

### AWS credentials and SigV4

Install the optional AWS dependencies to sign requests with SigV4:

```sh
npm install @aws-sdk/credential-provider-node @smithy/hash-node @smithy/signature-v4
```

Omit explicit authentication to use the default AWS credential chain, or select a shared-config profile:

```ts
const client = new OpenAI({
  provider: bedrock({
    region: 'us-west-2',
    profile: 'my-profile',
  }),
});
```

You can also pass `accessKeyId` and `secretAccessKey`, with an optional `sessionToken`, or provide refreshable credentials with `credentialProvider`.

SigV4 authentication is supported in Node.js and compatible server runtimes. Bearer authentication can be used in other runtimes without loading the optional AWS packages.

The SDK's current SigV4 mode requires a replayable, buffered body such as a string, `ArrayBuffer`, or typed-array view. The standard JSON API methods already meet this requirement. Custom `FormData`, readable streams, and other non-replayable request bodies are rejected before sending; response streaming is unaffected. Signed requests also do not automatically follow redirects, because the redirect target would require a new signature.

Bedrock Mantle also supports `UNSIGNED-PAYLOAD` and AWS-chunked request signing, but this SDK does not enable those modes. Mantle waits for the complete request body before authentication and authorization, so streaming a request body does not reduce request latency.

## Legacy `BedrockOpenAI` class

The `BedrockOpenAI` class remains available for existing applications. It accepts the legacy `awsRegion`, `awsProfile`, `awsCredentialsProvider`, and `bedrockTokenProvider` option names and uses the same `/openai/v1` endpoint as the provider:

```ts
import { BedrockOpenAI } from 'openai';

const client = new BedrockOpenAI({
  awsRegion: 'us-west-2',
  awsProfile: 'my-profile',
});
```

New applications should prefer `new OpenAI({ provider: bedrock(...) })`.
