# Amazon Bedrock

To use this library with [Amazon Bedrock's OpenAI-compatible API](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html), use the `BedrockOpenAI`
class instead of the `OpenAI` class.

```ts
import { BedrockOpenAI } from 'openai';

// gets the bearer token from AWS_BEARER_TOKEN_BEDROCK and the region from AWS_REGION/AWS_DEFAULT_REGION
const client = new BedrockOpenAI();

const response = await client.responses.create({
  model: 'openai.gpt-5.4',
  input: 'Say hello!',
});

console.log(response.output_text);
```

`BedrockOpenAI` configures AWS bearer auth and the Bedrock Mantle endpoint, then uses the normal SDK resources. AWS controls which endpoints and features are supported; unsupported calls surface the provider's normal HTTP errors through the SDK.

Pass `baseURL` or set `AWS_BEDROCK_BASE_URL` to override the derived `https://bedrock-mantle.<region>.api.aws/openai/v1` endpoint. For long-running apps, pass `bedrockTokenProvider` to refresh the Bedrock bearer token before each request.

Set `AWS_BEARER_TOKEN_BEDROCK` to an [Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html). To refresh tokens yourself, pass a provider instead of `apiKey`:

```ts
const client = new BedrockOpenAI({
  awsRegion: 'us-west-2',
  bedrockTokenProvider: async () => refreshBedrockToken(),
});
```
