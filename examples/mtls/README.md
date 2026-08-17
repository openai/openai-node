# HTTP mTLS examples

These examples keep mTLS configuration at the HTTP transport layer. The SDK receives the configured transport through its existing `fetch` and `fetchOptions` options. Before running them, follow the [OpenAI Mutual TLS Beta Program](https://help.openai.com/en/articles/10876024-openai-mutual-tls-beta-program) instructions to enroll, upload, and activate the appropriate certificate for your organization or project.

The original Node.js, Deno, and Bun examples combine an API key with HTTP mTLS. They do not perform X.509 workload identity token exchange. The separate Node.js toggle example demonstrates first-class X.509 workload identity federation.

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

## X.509 workload identity federation (Node.js)

[`x509-wif-node.mjs`](./x509-wif-node.mjs) uses an application-owned `OPENAI_AUTH_MODE=api_key|x509` rollout toggle. In `x509` mode, set:

```sh
export OPENAI_AUTH_MODE='x509'
export OPENAI_IDENTITY_PROVIDER_ID='idp_...'
export OPENAI_SERVICE_ACCOUNT_ID='svc_acct_...'
export OPENAI_MTLS_CERTIFICATE_CHAIN='/path/to/client-chain.pem'
export OPENAI_MTLS_PRIVATE_KEY='/path/to/client-key.pem'
# Optional:
export OPENAI_MTLS_PRIVATE_KEY_PASSWORD='...'
export OPENAI_BASE_URL='https://mtls.api.openai.com/v1'
```

Run it with `node x509-wif-node.mjs`. Omit `OPENAI_BASE_URL` to use the X.509-only default `https://mtls.api.openai.com/v1`. In `api_key` mode, only `OPENAI_API_KEY` is required and the ordinary API endpoint is used.

The SDK sends the certificate-authenticated token exchange through the same client-level `fetch` and `fetchOptions.dispatcher` as API requests. Per-request `fetchOptions` are rejected because the cached workload identity is scoped to the client transport. The SDK never reads certificate files itself, never accepts a configurable exchange URL, and refuses redirects in X.509 mode. The application remains responsible for closing the dispatcher and rebuilding it for certificate rotation.

X.509 workload identity requires a static Undici `Agent` TLS configuration with the default origin factory, or a `ProxyAgent` whose destination certificate is configured in `requestTls` and kept separate from `proxyTls`. Load PEM certificate, key, and CA files as UTF-8 strings. Dynamic connectors, custom origin factories, mutable TLS containers such as `Buffer`s or arrays, and opaque executable dispatchers are deliberately unsupported because the SDK cannot prove that token exchange and API dispatch will present the same certificate. Bun X.509 mode supports HTTP CONNECT proxies but rejects HTTPS proxies, including inherited proxy environment variables.
