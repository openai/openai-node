# Microsoft Azure OpenAI

To use this library with [Azure OpenAI](https://learn.microsoft.com/azure/ai-services/openai/overview), use the `AzureOpenAI`
class instead of the `OpenAI` class.

> [!IMPORTANT]
> The Azure API shape slightly differs from the core API shape which means that the static types for responses / params
> won't always be correct.

```ts
import { AzureOpenAI } from 'openai';
import { getBearerTokenProvider, DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

const openai = new AzureOpenAI({ azureADTokenProvider, apiVersion: "<The API version, e.g. 2024-10-01-preview>" });

const result = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello!' }],
});

console.log(result.choices[0]!.message?.content);
```

For more information on support for the Azure API, see [azure.md](azure.md).

## Realtime API

This SDK provides real-time streaming capabilities for Azure OpenAI through the `OpenAIRealtimeWS` and `OpenAIRealtimeWebSocket` clients described previously.

To utilize the real-time features, begin by creating a fully configured `AzureOpenAI` client and passing it into either `OpenAIRealtimeWS.azure` or `OpenAIRealtimeWebSocket.azure`. For example:

```ts
const cred = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const deploymentName = 'gpt-4o-realtime-preview-1001';
const azureADTokenProvider = getBearerTokenProvider(cred, scope);
const client = new AzureOpenAI({
  azureADTokenProvider,
  apiVersion: '2024-10-01-preview',
  deployment: deploymentName,
});
const rt = await OpenAIRealtimeWS.azure(client);
```

Once the instance has been created, you can then begin sending requests and receiving streaming responses in real time.
