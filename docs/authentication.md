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
Returning `undefined` or empty headers from `authHeaders` or `bearerAuth` retains the subject-token
workload fallback when no Authorization override is present. Return an explicit `Authorization: null`
header layer, or delete Authorization from an SDK-produced result, to suppress authentication.
For subject-token workload identity, a transport hook that dispatches without delegating to the SDK's
`fetchWithTimeout` owns its authentication retries. The SDK records token usage immediately before
calling the configured `fetch`, then conservatively revokes retry ownership if the supplied request's
observable Authorization state changes before `fetch` resolves. This also applies to header changes
during post-send cleanup; the SDK cannot verify which credential an independent transport sent.
When a hook makes several delegated sends, authentication retry follows the response the hook returns.
Native `response.clone()` calls made inside a transport hook are caller-owned and do not carry automatic
workload-token retry attribution. A subclass can use the protected `this.cloneResponse(response)` helper
when it intentionally returns a clone of a delegated response and wants to preserve that attribution.
The SDK does not replace native `Response` or `Headers` methods. An exact same-byte mutation of a native
`Headers` object is therefore treated as unchanged; return an independent header record or `buildHeaders`
result when the same bytes must carry independent credential ownership.
Requests with streamed upload bodies cannot be replayed; see the
[upload retry guidance](uploads.md#streaming-and-retries).

### Authentication and transport hooks

SDK-produced authentication and request results retain workload-token ownership when delegating hooks
copy options, including frozen options, or rebuild headers with the SDK's `buildHeaders` helper.
Existing overrides that retain those marked header values do not need a new argument. Hooks that
reconstruct request options can also forward the optional opaque request context:

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
An in-place native Authorization overwrite is observable when it changes the emitted bytes or the header
object's effective mutator shape. A changed value or removal revokes that header layer's refresh ownership,
and subsequent header copies do not restore SDK ownership. An exact same-byte `set`, or a `delete` followed
by restoring the original value before the next hook boundary, is treated as unchanged; subsequent native
copies retain their prior SDK ownership.

The SDK checks Authorization at hook boundaries without replacing native `Headers` methods. An independent
header layer observed between SDK hook calls remains independent after a later copy. Parsed copies have
independent mutation state; changing an unused copy does not invalidate the selected request. Headers with
custom, accessor-backed, or otherwise nonstandard mutators retain their normal operations, but do not enable
automatic authentication refresh. To mark equal-byte credentials as independent, express them as a record
or tuple layer through `buildHeaders` and return that layer to the SDK before further copying it.

Return the SDK-produced authentication result, retain its marked header values, or rebuild it with
`buildHeaders([result, additionalHeaders])` to preserve ownership. Immediate delegation can also copy
both the result container and its values with native `Headers`. This compatibility behavior treats an
unmarked copy matching the last credential selected by that request's authentication hook as forwarding
that credential; it cannot distinguish an independent equal-byte native copy. Explicit independent
layers and observed Authorization value changes still prevent workload-token refresh.
If a hook awaits before delegating with copied options and returns unmarked copied values, forward the
opaque context to retain the original authentication scope. Without that context, the request keeps its
original `401` without a workload-token refresh.
Rebuilt request results likewise need marked headers or their SDK request carrier to retain credential
ownership; ordinary request object spread preserves that carrier.

A `prepareRequest` hook may copy headers with `new Headers(req.headers)` and add unrelated headers
while retaining automatic workload refresh. As at transport hooks, an unmarked replacement with
unchanged Authorization bytes retains this compatibility behavior. Explicit independent provenance
and observed Authorization writes still disable refresh. An arbitrary unmarked equal-byte
replacement cannot be distinguished from a legitimate copy.

A `buildRequest` override keeps first access to its original inputs before SDK snapshotting. Ordinary
delegation can copy options and native input headers without forwarding a new argument. A nested build
that reuses a source already consumed by an active request must forward the complete settings argument,
including `credentialContext`; without that owner, the SDK rejects the build before acquiring or
dispatching credentials. Retrying non-replayable inputs requires retaining the original options or
forwarding `credentialContext`, including when the hook ignores the input and selects replacement headers.
The hook may run and read its input again on a retry; retain parsed one-shot layers when their values are
needed again. Before acquiring credentials, the owned base build rejects a retry that loses a previously
selected independent Authorization value or removal. Stable replacements, including genuine foreign
`Headers` copies, can retry without treating an ignored raw input as consumed.
If a hook drops ownership on a later retry, the SDK rejects its returned request before dispatch; any
standalone credential acquisition performed inside that hook may already have occurred.

When previously observed duplicate positions are displaced or the occurrence count decreases, the SDK
re-evaluates all of that tuple's cached accessor values. This includes reordering and removal followed
by reinsertion at an equal count: the SDK cannot identify which duplicate occurrence survived and
reads the current values again. Unchanged duplicate positions retain their one-shot values, including
when new occurrences are appended after them.
Within a native array-valued header, accessor slots are retained individually while ordinary data
slots continue to refresh, including when a credential provider updates them during acquisition.
When replaying a header record, current enumerable aliases take precedence over a retained accessor
that removed itself. Their current order is preserved, including unchanged values and explicit `null`
removals; the SDK does not infer whether a property was deleted and reinserted between observations.
An alias that emits no value, such as an empty array, does not override the retained value. Retained
accessors are not read again.
If previously available property-descriptor evidence becomes unavailable while replaying an
`Authorization` source, row, or nested value, the SDK rejects the request before dispatch. Keep that
evidence available or provide a new header layer; the SDK does not consume a one-shot getter again to
recover lost evidence.

Hooks that consume one-shot header iterables must keep the parsed headers if later SDK processing
needs them, for example by assigning the parsed result to `options.headers`. The SDK does not replace
caller-owned header sources before `prepareOptions` or bodyless custom authentication hooks run.
Forwarding the context alone cannot recover inputs consumed after an await; pass the retained parsed
headers to subsequent builds. This also applies to unverified foreign collections whose replayability
cannot be established.

Foreign Headers-shaped implementations retain previously observed header names missing during replay,
while applying every newly observed value. To intentionally delete headers in such an implementation,
replace the header layer, or use an explicit record with `Authorization: null`; missing rows alone
cannot establish that removal. Foreign additions and value updates still refresh. Native `Headers`,
arrays, and data records retain live refresh behavior.
Tuple-array refresh reads the array's data length when it matched the first traversal, preserving
ordinary growth and truncation without repeating a custom length getter. Otherwise it retains the
first traversal's row boundary; replace the header source to select a different boundary.

When attributing a workload credential at dispatch, the SDK preserves local native `Headers` identity.
Records, tuple arrays, and other iterable implementations, including foreign `Headers` collections,
are materialized once and that same snapshot is passed to the transport. Data descriptors cannot prove
that a record or array is free of stateful proxy reads.
Protected request and transport hooks keep the original request object and its header source until
the final dispatch snapshot. Accessors therefore observe the same request fields that later hooks
update. If a hook replaces an opaque, unconsumed source with unmarked copied headers, equal token
bytes alone cannot restore its refresh ownership; retain SDK-marked values when forwarding ownership.
A request `headers` getter may return an unmarked native copy with the selected credential, just like
a data property. It is read at dispatch and retains the same accepted equal-byte copy ambiguity.
An observed independent layer or Authorization overwrite still disables refresh, including through
subsequent accessor copies.
Structural constructor/tag descriptors cannot establish that a custom `get()` method agrees with its
iterator. Foreign collection identity and custom properties are therefore not retained on this path.
Header values remain supported, as does workload refresh when SDK credential ownership is retained.
Headers from a foreign `Request` are also materialized into the dispatch snapshot while the `Request`
object retains its identity.
Native `Request` delegation is unchanged.
Resolving the legacy workload placeholder in native `Headers` updates that collection in place,
including when its outer request is frozen. A later delegated send can reuse the resolved headers.

`fetchWithAuth` and `fetchWithTimeout` also accept the context as their final argument. Ordinary object
spread retains the SDK request carrier, including when a legacy wrapper also replaces the controller.
Forward the context when reconstruction discards that carrier and replaces both request and controller
identity. Changing either one alone preserves the original request's identity. Forward the same context
object; copying it loses request ownership.

## Third-party providers

The `provider` client option configures a third-party endpoint and its
authentication together. It cannot be combined with top-level `apiKey`,
`adminAPIKey`, `workloadIdentity`, or `baseURL` options.

See [Amazon Bedrock](bedrock.md) for bearer-token and AWS SigV4 authentication,
and [Microsoft Azure OpenAI](azure.md) for Azure v1 and dated API versions.
