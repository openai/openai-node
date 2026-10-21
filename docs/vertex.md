# Google Vertex AI

Use the standard `OpenAI` client with the Vertex provider to call the Responses API. You need a Google Cloud project with access to an enabled model.

For Application Default Credentials (ADC), install the optional Google authentication library alongside the SDK:

```sh
npm install openai 'google-auth-library@>=9.15.1 <11'
```

```ts
import OpenAI from 'openai';
import { vertex } from 'openai/providers/vertex';

const client = new OpenAI({
  provider: vertex({ project: 'my-google-project', location: 'us-east5' }),
});

const response = await client.responses.create({
  model: 'your-enabled-model',
  input: 'Hello',
  store: false,
});

console.log(response.output_text);
```

The project and location default to `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. Model and feature availability depend on your Vertex deployment. Streaming, tools, timeouts, and retries use the ordinary SDK methods and options.

You can pass an existing Google auth client as `credentials`, or provide `tokenProvider` if your application manages token refresh. A token provider runs before each request attempt and does not require `google-auth-library`, including in bundled applications. For ADC, install `google-auth-library` before bundling and keep it available at runtime for bundles that leave it external. Authentication uses Google credentials; no OpenAI API key is needed.

To use a custom endpoint, set `baseURL` to the complete API root before `/responses`. The provider sends Google credentials to that origin, so use HTTPS to protect them in transit. Google API endpoints require HTTPS. Redirects are disabled.
