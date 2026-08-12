# Microsoft Azure OpenAI

## v1 API

For Azure OpenAI's current [v1 API](https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle),
use the standard `OpenAI` client with your Azure endpoint:

```ts
import OpenAI from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';

const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'];
if (!endpoint || !deployment) throw new Error('Missing Azure OpenAI configuration');

const tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');

const openai = new OpenAI({
  baseURL: `${endpoint.replace(/\/+$/, '')}/openai/v1/`,
  apiKey: tokenProvider,
});

const result = await openai.chat.completions.create({
  model: deployment,
  messages: [{ role: 'user', content: 'Say hello!' }],
});

console.log(result.choices[0]!.message?.content);
```

With the v1 API, the `model` parameter is your Azure deployment name. See the
[Azure examples](../examples/azure) for complete runnable programs.

## Dated API versions

For dated Azure OpenAI API versions, use the `AzureOpenAI` class instead of the `OpenAI` class.

> [!IMPORTANT]
> The Azure API shape slightly differs from the core API shape which means that the static types for responses / params
> won't always be correct.

> [!WARNING]
> The Azure OpenAI Assistants API is deprecated and will be retired on August 26, 2026. For existing integrations,
> see the [Azure Assistants example](../examples/azure/assistants.ts).

```ts
import { AzureOpenAI } from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

const openai = new AzureOpenAI({
  azureADTokenProvider,
  apiVersion: '<The API version, e.g. 2024-10-01-preview>',
});

const result = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello!' }],
});

console.log(result.choices[0]!.message?.content);
```

For OpenAI workload identity on Azure-managed infrastructure, see [Authentication](authentication.md).

## Realtime API

Use the stable Realtime API with your Azure v1 endpoint and deployment name. The
`OpenAIRealtimeWS` and `OpenAIRealtimeWebSocket` helpers connect to the GA
`/openai/v1/realtime` endpoint without a dated `api-version` query parameter:

```ts
import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
const deploymentName = process.env['AZURE_OPENAI_DEPLOYMENT'];
if (!endpoint || !deploymentName) throw new Error('Missing Azure OpenAI configuration');

const tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://ai.azure.com/.default');
const client = new OpenAI({
  baseURL: `${endpoint.replace(/\/+$/, '')}/openai/v1/`,
  apiKey: tokenProvider,
});

const rt = await OpenAIRealtimeWS.create(client, { model: deploymentName });
```

If you already have an `AzureOpenAI` client, `OpenAIRealtimeWS.azure(client)` and
`OpenAIRealtimeWebSocket.azure(client)` also use the GA endpoint and the client's
configured deployment. Pass `{ deploymentName: 'your-deployment' }` to override
that deployment for a specific connection.
