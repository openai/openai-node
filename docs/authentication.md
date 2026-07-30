# Authentication

The SDK supports OpenAI API keys, refreshable credentials, and workload identity
federation. Authentication for Azure OpenAI and Amazon Bedrock is described in
their [Azure](azure.md) and [Bedrock](bedrock.md) guides.

## API keys

The standard client reads `OPENAI_API_KEY` automatically:

```ts
import OpenAI from 'openai';

const client = new OpenAI();
```

You can also provide an API key explicitly:

```ts
const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});
```

Keep API keys on a trusted server. Browser use is disabled by default because
credentials included in client-side code can be extracted. Only enable
`dangerouslyAllowBrowser` when you understand and have mitigated that risk.

### Refreshable API credentials

Pass an asynchronous function when a credential can rotate or expire. The SDK
calls the function before each request attempt and requires a nonempty string:

```ts
const client = new OpenAI({
  apiKey: async () => {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    return apiKey;
  },
});
```

This also works with an OAuth bearer-token provider for a compatible endpoint;
see the [Azure v1 example](azure.md#v1-api).

### Environment and client configuration

The client reads these optional environment variables when their corresponding
options are not supplied:

- `OPENAI_API_KEY`: Standard API credential.
- `OPENAI_ADMIN_KEY`: Credential for endpoints requiring an admin key.
- `OPENAI_ORG_ID`: Organization sent with requests.
- `OPENAI_PROJECT_ID`: Project sent with requests.
- `OPENAI_BASE_URL`: Alternate OpenAI-compatible API endpoint.

The matching options are `apiKey`, `adminAPIKey`, `organization`, `project`, and
`baseURL`.

## Workload identity

Workload identity exchanges a short-lived cloud identity token for an OpenAI
access token. Configure the external identity provider and OpenAI service
account first, then provide:

- `identityProviderId`: Your OpenAI identity-provider resource ID.
- `serviceAccountId`: The OpenAI service account that receives the identity.
- `provider`: A subject-token provider for Kubernetes, Azure, GCP, or your own
  identity system.

The optional `clientId` field is included in the token exchange when required
by your identity configuration.

`workloadIdentity` and `apiKey` are mutually exclusive. Because `OPENAI_API_KEY`
is loaded automatically, unset that environment variable or pass `apiKey: null`
when using workload identity in an environment where an API key is already set:

```ts
import OpenAI from 'openai';
import { k8sServiceAccountTokenProvider } from 'openai/auth';

const client = new OpenAI({
  apiKey: null,
  workloadIdentity: {
    identityProviderId: 'idp-123',
    serviceAccountId: 'sa-456',
    provider: k8sServiceAccountTokenProvider(),
  },
});

const response = await client.responses.create({
  model: 'gpt-5.5',
  input: 'Say hello!',
});

console.log(response.output_text);
```

### Kubernetes

`k8sServiceAccountTokenProvider()` reads the mounted Kubernetes service account
token. The default path is
`/var/run/secrets/kubernetes.io/serviceaccount/token`; supply a different path
when using a custom or projected token:

```ts
import { k8sServiceAccountTokenProvider } from 'openai/auth';

const provider = k8sServiceAccountTokenProvider('/var/run/secrets/tokens/openai');
```

This provider reads from the filesystem and requires a runtime with Node.js file
access, unless you supply a custom `readFile` implementation.

### Azure managed identity

`azureManagedIdentityTokenProvider()` retrieves a token from the Azure Instance
Metadata Service. Its default resource is `https://management.azure.com/`;
provide another resource and, if necessary, a user-assigned identity:

```ts
import { azureManagedIdentityTokenProvider } from 'openai/auth';

const provider = azureManagedIdentityTokenProvider('https://management.azure.com/', {
  clientId: 'user-assigned-managed-identity-client-id',
});
```

Use this provider inside `workloadIdentity` to authenticate to OpenAI with an
Azure-hosted workload. Authenticating directly to Azure OpenAI is a different
configuration; see the [Azure guide](azure.md).

### Google Cloud

`gcpIDTokenProvider()` requests an identity token from the Compute Engine
metadata server. Its default audience is `https://api.openai.com/v1`:

```ts
import { gcpIDTokenProvider } from 'openai/auth';

const provider = gcpIDTokenProvider();
```

Pass a different audience when your identity-provider configuration requires it:

```ts
const provider = gcpIDTokenProvider('https://example.com/openai-workload-identity');
```

### Custom subject-token providers

A custom provider specifies whether its token is a JWT or an identity token and
returns a fresh subject token whenever the SDK performs a token exchange:

```ts
const client = new OpenAI({
  apiKey: null,
  workloadIdentity: {
    identityProviderId: 'idp-123',
    serviceAccountId: 'sa-456',
    provider: {
      tokenType: 'jwt',
      getToken: async () => {
        const token = process.env['WORKLOAD_SUBJECT_TOKEN'];
        if (!token) throw new Error('Missing WORKLOAD_SUBJECT_TOKEN');
        return token;
      },
    },
  },
});
```

Use `tokenType: 'id'` when the provider returns an identity token instead.

### Token caching and refresh

The SDK exchanges subject tokens at `https://auth.openai.com/oauth/token`,
caches the resulting OpenAI access token, and refreshes it before expiration.
The default refresh buffer is 1,200 seconds, or 20 minutes:

```ts
const client = new OpenAI({
  apiKey: null,
  workloadIdentity: {
    identityProviderId: 'idp-123',
    serviceAccountId: 'sa-456',
    provider: k8sServiceAccountTokenProvider(),
    refreshBufferSeconds: 120,
  },
});
```

Concurrent token refreshes are shared. If a replayable request receives a `401`,
the SDK also invalidates the cached token and retries once with a fresh token.
Requests with streamed upload bodies cannot be replayed; see the
[upload retry guidance](uploads.md#streaming-and-retries).

## Third-party providers

The `provider` client option configures a third-party endpoint and its
authentication together. It cannot be combined with top-level `apiKey`,
`adminAPIKey`, `workloadIdentity`, or `baseURL` options.

See [Amazon Bedrock](bedrock.md) for bearer-token and AWS SigV4 authentication,
and [Microsoft Azure OpenAI](azure.md) for Azure v1 and dated API versions.
