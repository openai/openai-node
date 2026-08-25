# API-key + HTTP mTLS examples

These examples keep mTLS configuration at the HTTP transport layer. The SDK receives the configured transport through its existing `fetch` and `fetchOptions` options. Before running them, follow the [OpenAI Mutual TLS Beta Program](https://help.openai.com/en/articles/10876024-openai-mutual-tls-beta-program) instructions to enroll, upload, and activate the appropriate certificate for your organization or project.

All three examples expect:

```sh
export OPENAI_API_KEY='sk-...'
export OPENAI_MTLS_CERT_PATH='/path/to/client-cert-chain.pem'
export OPENAI_MTLS_KEY_PATH='/path/to/client-key.pem'
```

`OPENAI_MTLS_CERT_PATH` must point to one PEM file containing the leaf client certificate first, followed by every required intermediate certificate. The examples default to `https://mtls.api.openai.com/v1`; set `OPENAI_BASE_URL=https://mtls-eu.api.openai.com/v1` for EU Data Residency.

Each example requests `models.list()` and prints the number of returned models. They set `redirect: 'manual'` so the certificate-bearing transport does not automatically follow redirects to another host.

## Node.js with Undici

Install Undici alongside the SDK:

```sh
npm install openai undici
node node.mjs
```

The Node.js example uses `undici.Agent({ connect: { cert, key } })`, passes the matching `undici.fetch`, and closes the dispatcher when finished. Use a Node.js version supported by the Undici release npm installs; current Undici 8 requires Node.js 22.19 or later. For an encrypted PEM private key, also set `OPENAI_MTLS_KEY_PASSPHRASE`; passphrase handling is an Undici/Node transport capability rather than an SDK option.

## Deno

```sh
deno run --allow-env --allow-read --allow-net deno.mjs
```

The Deno example uses `Deno.createHttpClient`, maps the client-certificate option names across the supported Deno 1.28+ range, attaches that client inside a custom `fetch`, and closes the HTTP client when finished. On Deno 1.x, where `Deno.createHttpClient` is still unstable, add the flag to the command:

```sh
deno run --unstable --allow-env --allow-read --allow-net deno.mjs
```

## Bun

```sh
bun add openai
bun bun.mjs
```

The Bun example passes `tls: { cert, key }` to Bun's native `fetch`.

## Advanced transports

Because the SDK does not own the mTLS transport, applications can use runtime-native features such as proxies, custom trust stores, encrypted keys, hardware-backed keys, or certificate rotation where their chosen HTTP client supports them. Keep the certificate-bearing transport scoped to the OpenAI mTLS endpoint, and close or replace it when rotating credentials.

## X.509 workload identity (Node.js)

X.509 workload identity is separate from API-key + HTTP mTLS: an enrolled client certificate authenticates a workload-identity token exchange, and the resulting short-lived bearer authenticates requests through the same caller-owned certificate transport. The resulting access token is an ordinary bearer credential, so protect it like any other secret; reusing the approved certificate transport does not cryptographically bind the token to that certificate. Only `https://mtls.api.openai.com/v1` is approved; EU, Azure, Bedrock, custom gateways, and data-residency overrides are not supported.

Install the SDK and its optional Node.js transport peer:

```sh
npm install openai 'undici@^7'
```

Undici 7 supports the SDK's complete Node.js 22 compatibility range; Undici 8 requires Node.js 22.19 or later.

Provide the complete PEM certificate chain, private key, enrolled identity-provider ID, and service-account ID through environment variables. The chain must contain the leaf certificate followed by any required intermediates:

```sh
export OPENAI_X509_CLIENT_CERTIFICATE_CHAIN_PEM="$(cat /secure/path/client-chain.pem)"
export OPENAI_X509_CLIENT_PRIVATE_KEY_PEM="$(cat /secure/path/client-key.pem)"
export OPENAI_X509_IDENTITY_PROVIDER_ID='your-enrolled-identity-provider-id'
export OPENAI_X509_SERVICE_ACCOUNT_ID='your-enrolled-service-account-id'

# Build package self-imports when running the example from an SDK repository checkout.
pnpm build
node examples/mtls/x509-workload-identity.mjs
```

Set `OPENAI_X509_CLIENT_KEY_PASSPHRASE` when the PEM private key is encrypted. Existing local fixtures can instead provide certificate and key paths through `OPENAI_MTLS_CERT_CHAIN` and `OPENAI_MTLS_KEY`, identity selectors through `OPENAI_IDENTITY_PROVIDER_ID` and `OPENAI_SERVICE_ACCOUNT_ID`, and an optional tenant through `OPENAI_X509_PROJECT_ID`. The example ignores ambient API keys, admin keys, base URLs, organizations, and ordinary API-key projects so only the selected X.509 identity and tenant determine the request. Keep private-key files readable only by their owner, use managed secret injection where available, and never log PEM contents, passphrases, issued bearer tokens, or proxy credentials.

Proxying is always explicit: set `OPENAI_X509_PROXY_MODE=http_connect` or `OPENAI_X509_PROXY_MODE=https_connect` together with a matching `HTTPS_PROXY` URL. The default `direct` mode ignores ambient proxy variables. The workload certificate is configured only for target TLS, never proxy TLS. The example closes its caller-owned dispatcher after the request.

From a repository checkout, the following command builds the SDK first and then runs the same explicit live-service check:

```sh
pnpm test:live:x509
```

This check fails without owner-provisioned, enrolled credentials. Rotate a certificate by constructing a new Undici dispatcher and `createX509Transport` capability, then creating or cloning the client with that new top-level `x509Transport`; close the previous dispatcher after in-flight requests finish.
