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

Concurrent HTTP requests keep each function result with the request attempt that
resolved it. Retries call the provider again. The client still exposes the most
recently resolved value as `client.apiKey`, which can change while another
request is being prepared.

Subclasses that override request preparation or authentication hooks should
forward the optional credential context to `super`. A forwarding `prepareOptions`
override can replace the current attempt's credential by assigning
`credentialContext.apiKey` after awaiting `super.prepareOptions`. Updating
`this.apiKey` changes the shared client property, not a captured function result.
Legacy `prepareOptions` overrides that omit the context retain their shared-key
behavior. During request building, legacy delegating hooks can recover a captured
credential from the original options object when it belongs to one active attempt.
Hooks that copy options or reuse the same options concurrently should forward the
context to preserve function-key isolation.

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

Workload identity exchanges either a short-lived cloud identity token or an
enrolled X.509 client certificate for an OpenAI access token. For the
subject-token flow, configure the external identity provider and OpenAI service
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

### X.509 client certificates

Enrolled Node.js applications can authenticate using an SDK-owned certificate
credential instead of a subject-token provider. Install the optional Undici peer
with `npm install openai "undici@^7"` and provide the full PEM certificate chain,
matching private key, and enrolled account selectors:

```ts
import OpenAI from 'openai';
import { workloadIdentity } from 'openai/auth/x509-transport';

const credential = workloadIdentity.fromX509({
  certificateChain: process.env['OPENAI_X509_CLIENT_CERTIFICATE_CHAIN_PEM']!,
  privateKey: process.env['OPENAI_X509_CLIENT_PRIVATE_KEY_PEM']!,
  identityProviderId: process.env['OPENAI_X509_IDENTITY_PROVIDER_ID']!,
  serviceAccountId: process.env['OPENAI_X509_SERVICE_ACCOUNT_ID']!,
});

try {
  const client = new OpenAI({
    credential,
    project: process.env['OPENAI_X509_PROJECT_ID'] ?? null,
  });

  console.log((await client.models.list()).data.length);
} finally {
  await credential.close();
}
```

X.509 authentication supports only `https://mtls.api.openai.com/v1`. Azure,
Bedrock, custom gateways, data-residency overrides, browsers, and WebSocket
transports are unsupported. Call `credential.close()` when requests have drained.

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

Concurrent token refreshes are shared. If a replayable request using a workload-identity token receives
a `401`, the SDK also invalidates the cached token and retries once with a fresh token.
For subject-token workload identity, an independent `Authorization` header override in `defaultHeaders`
or request `headers` skips token acquisition, including `null` to remove the header or an empty string.
Subclasses that override authentication hooks retain control of credential resolution.
For subject-token workload identity, a transport hook that dispatches without delegating to the SDK's
`fetchWithTimeout` owns its authentication retries. The SDK records token usage immediately before
calling the configured `fetch`; it cannot verify which credential an independent transport sent.
Requests with streamed upload bodies cannot be replayed; see the
[upload retry guidance](uploads.md#streaming-and-retries).

### Authentication and transport hooks

SDK-produced authentication and request results retain workload-token ownership when delegating hooks
copy options, including frozen options, or rebuild headers with the SDK's `buildHeaders` helper.
Existing overrides that return those results do not need a new argument. Hooks that reconstruct result
objects can also forward the optional opaque request context:

```ts
import OpenAI from 'openai';
import type { FinalRequestOptions } from 'openai/internal/request-options';

class WrappedClient extends OpenAI {
  protected override async authHeaders(
    options: FinalRequestOptions,
    schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
    context?: object,
  ) {
    return super.authHeaders({ ...options }, schemes, context);
  }
}
```

`bearerAuth` receives the context as its second argument. `buildRequest` overrides can forward the
complete second argument, including `credentialContext`, when rebuilding SDK results. An independent
Authorization layer replaces the SDK credential's provenance even when the string values are equal.

Immediate delegating calls also retain ownership when copying both options and native headers. A hook
that awaits before delegating, copies its options, and reconstructs the authentication result with
native `Headers` must forward the context. Once both identities are discarded across an asynchronous
boundary, ownership cannot be inferred safely from matching credential strings.

A `buildRequest` override keeps first access to its original inputs before SDK snapshotting. Ordinary
delegation can copy options and native input headers without forwarding a new argument. A nested build
that reuses a source already consumed by an active request must forward the complete settings argument,
including `credentialContext`; without that owner, the SDK rejects the build before acquiring or
dispatching credentials. A custom hook materializing a one-shot input must retain its parsed layer
(for example, in `options.headers`) before an automatic retry; otherwise the SDK rejects the repeat
instead of letting an exhausted input silently remove an independent credential.

Hooks that consume one-shot header iterables must keep the parsed headers if later SDK processing
needs them, for example by assigning the parsed result to `options.headers`. The SDK does not replace
caller-owned header sources before `prepareOptions` or bodyless custom authentication hooks run.

Foreign Headers-shaped implementations retain previously observed header names missing during replay,
while applying every newly observed value. To intentionally delete headers in such an implementation,
replace the header layer, or use an explicit record with `Authorization: null`; missing rows alone
cannot establish that removal. Foreign additions and value updates still refresh. Native `Headers`,
arrays, and data records retain live refresh behavior.

`fetchWithAuth` and `fetchWithTimeout` also accept the context as their final argument. Forward it when
a transport wrapper replaces both the request object and its abort controller. Changing either one
alone preserves the original request's identity. Forward the same context object; copying it loses
request ownership.

## Third-party providers

The `provider` client option configures a third-party endpoint and its
authentication together. It cannot be combined with top-level `apiKey`,
`adminAPIKey`, `workloadIdentity`, or `baseURL` options.

See [Amazon Bedrock](bedrock.md) for bearer-token and AWS SigV4 authentication,
and [Microsoft Azure OpenAI](azure.md) for Azure v1 and dated API versions.
