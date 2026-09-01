# Security Model

The repository's canonical security policy is `.github/SECURITY.md`; this is
the canonical detailed threat model that policy references for the `openai`
JavaScript and TypeScript SDK repository. Codex Security scans should load this
document from the exact scanned revision rather than relying on a copied model
in external scan configuration. It records reusable architecture and
trust-boundary context; the scenarios below are hypotheses and calibration
examples, not findings.

## 1. Overview

The published `openai` package is an outbound API client library, not an
application server or authorization service. It exports CommonJS and ESM
entrypoints for the default client, authentication helpers, and public
subpaths, with optional peer integrations for providers, WebSockets, and schema
validation (`package.json:2-20`, `package.json:85-150`). The root entrypoint
exports `OpenAI`, `AzureOpenAI`, `BedrockOpenAI`, uploads, errors, pagination,
and authentication-related types (`src/index.ts:1-27`).

Applications construct a client, call generated resource methods, and send
requests through URL, header, body, authentication, retry, and transport logic
in `src/client.ts`. Responses return through JSON, text, binary, SSE, or
WebSocket parsing before the embedding application consumes them. Webhooks flow
in the other direction: an application passes received bytes and headers to the
SDK verifier before parsing (`src/client.ts:505-612`,
`src/client.ts:878-898`, `src/client.ts:1147-1235`,
`src/internal/parse.ts:17-93`, `src/resources/webhooks/webhooks.ts:7-79`).

| Component or workflow                                         | Role                                                                                                                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/client.ts` and generated `src/resources/`                | Public REST clients, request construction, header normalization, authentication, dispatch, retries, and resource methods                            | `src/index.ts:1-27`, `src/client.ts:505-612`, `src/client.ts:1147-1235`, `src/client.ts:1524-1587`, `src/internal/headers.ts:29-94`                                                                                                                                                                                                                                                                                                                    |
| `src/azure.ts`, `src/bedrock.ts`, and `src/auth/`             | Provider-specific credential selection, origin controls, metadata token providers, and workload token exchange                                      | `src/azure.ts:86-214`, `src/bedrock.ts:144-265`, `src/auth/workload-identity-auth.ts:136-283`, `src/auth/subject-token-providers.ts:181-220`, `src/auth/subject-token-providers.ts:237-347`, `src/auth/subject-token-providers.ts:363-430`                                                                                                                                                                                                             |
| `src/providers/bedrock.ts` and `src/providers/bedrock/aws.ts` | Public Bedrock provider entrypoints for bearer credentials and AWS SigV4 signing                                                                    | `src/providers/bedrock.ts:14-50`, `src/providers/bedrock/aws.ts:26-64`, `src/providers/bedrock/aws.ts:161-249`, `src/providers/bedrock/aws.ts:252-289`                                                                                                                                                                                                                                                                                                 |
| `src/internal/data-residency.ts`                              | Public regional-destination selection and client-clone inheritance for OpenAI REST authority                                                        | `src/internal/data-residency.ts:6-44`, `src/client.ts:505-571`, `src/client.ts:648-727`, `src/azure.ts:86-100`, `src/bedrock.ts:144-158`                                                                                                                                                                                                                                                                                                               |
| `src/auth/x509-transport.ts` and `src/internal/auth/x509-*`   | Public X.509 credential/transport entrypoint, token exchange, guarded dispatch, cache, retry, and request isolation                                 | `package.json:85-127`, `src/auth/x509-transport.ts:34-55`, `src/auth/x509-transport.ts:156-358`, `src/internal/auth/x509-transport-capability.ts:52-226`, `src/internal/auth/x509-token-exchange.ts:38-310`, `src/internal/auth/x509-workload-identity-auth.ts:203-280`, `src/internal/auth/x509-workload-identity-auth.ts:497-577`, `src/internal/auth/x509-workload-identity-auth.ts:633-967`, `src/internal/auth/x509-transport-registry.ts:47-127` |
| `src/internal/parse.ts` and `src/core/streaming.ts`           | Decode API JSON, text, binary, SSE, and NDJSON responses with shared stream lifecycle cleanup                                                       | `src/internal/parse.ts:17-93`, `src/core/streaming.ts:88-456`                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/realtime/` and `src/beta/realtime/`                      | Stable and beta native/`ws` WebSocket handshakes and server-event parsing for Realtime APIs                                                         | `src/realtime/websocket.ts:112-249`, `src/realtime/internal-base.ts:155-166`, `src/realtime/internal-base.ts:252-306`, `src/realtime/ws.ts:63-105`, `src/beta/realtime/websocket.ts:132-263`, `src/beta/realtime/ws.ts:18-146`                                                                                                                                                                                                                         |
| `src/resources/{,beta/}responses/ws*.ts`                      | Public stable and beta Responses WebSocket handshakes, reconnect queues, iterator cleanup, and event dispatch                                       | `package.json:85-127`, `src/resources/responses/ws.ts:13-42`, `src/resources/responses/ws-base.ts:63-611`, `src/resources/beta/responses/ws.ts:13-42`, `src/resources/beta/responses/ws-base.ts:63-615`, `src/internal/ws.ts:151-185`                                                                                                                                                                                                                  |
| `src/lib/` and `src/helpers/`                                 | Structured-output parsing, schema validation, chat runners, embeddings decoding, and caller-supplied tool callbacks                                 | `src/lib/parser.ts:162-184`, `src/helpers/standard-schema.ts:703-805`, `src/lib/AbstractChatCompletionRunner.ts:446-499`, `src/lib/embeddings.ts:17-65`, `src/internal/utils/base64.ts:45-61`                                                                                                                                                                                                                                                          |
| `src/core/{api-promise,pagination}.ts`                        | Root-exported raw/parsed response promises and response-driven auto-pagination request loops                                                        | `src/index.ts:4-6`, `src/core/api-promise.ts:15-98`, `src/client.ts:970-992`, `src/core/pagination.ts:29-61`, `src/core/pagination.ts:73-111`, `src/core/pagination.ts:155-328`                                                                                                                                                                                                                                                                        |
| `src/internal/{to-file,uploads,multipart-encoding}.ts`        | Public file materialization plus buffered and streaming multipart encoding for caller-supplied files, filenames, blobs, responses, and streams      | `src/internal/to-file.ts:93-208`, `src/internal/uploads.ts:50-103`, `src/internal/uploads.ts:143-225`, `src/internal/uploads.ts:234-640`, `src/internal/multipart-encoding.ts:7-53`                                                                                                                                                                                                                                                                    |
| GitHub Actions                                                | Unprivileged PR/push checks, main-only live examples, trusted Castiron reporting, monthly Codex review, protected release and publication workflows | `.github/workflows/ci.yml:18-154`, `.github/workflows/ci.yml:260-313`, `.github/workflows/castiron-custom-code-comment.yml:4-24`, `.github/workflows/castiron-custom-code-comment.yml:116-200`, `.github/workflows/node-version-review.yml:17-111`, `.github/workflows/create-releases.yml:41-80`, `.github/workflows/create-releases.yml:288-346`                                                                                                     |

| Deployment or workflow      | Resource or capability                                                                                              | Configuration and precedence                                                                                                                                                            | Safe effective value or location                                                                       | Readers, writers, or recipients                                                             | Enforcing control                                                                                                                                                                                                                                                                                                           | Evidence or unknowns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default REST client         | API, admin, or workload credential; request and response data                                                       | Explicit client options, then environment defaults; caller may explicitly select a provider, `baseURL`, headers, hooks, or `fetch`                                                      | Default `https://api.openai.com/v1`; explicit operator configuration may select another authority      | Authorization headers and request bodies go to the resolved destination                     | Browser use is rejected unless explicitly enabled; callers remain responsible for trusted custom destinations and transports                                                                                                                                                                                                | `src/client.ts:490-518`, `src/client.ts:552-612`, `src/client.ts:813-825`, `src/client.ts:878-898`, `src/client.ts:1549-1587`                                                                                                                                                                                                                                                                                                                                                                         |
| Data residency              | API, admin, or workload credential and request data routed to a selected OpenAI region                              | Explicit `dataResidency` selects `global`, `us`, `eu`, or `ae`; it is mutually exclusive with explicit `baseURL`, providers, Azure, Bedrock, and X.509 identity                         | Region-derived OpenAI API root; clone inherits the selection unless explicitly replaced                | Selected regional OpenAI authority                                                          | Resolver maps only supported regions; constructor and clone preserve precedence and mutual exclusions; provider clients reject residency selection                                                                                                                                                                          | `src/internal/data-residency.ts:6-44`, `src/client.ts:505-571`, `src/client.ts:648-727`, `src/azure.ts:86-100`, `src/bedrock.ts:144-158`                                                                                                                                                                                                                                                                                                                                                              |
| Azure client                | Azure API key or Microsoft Entra token; deployment-aware request path                                               | Explicit `baseURL` or Azure endpoint, API version, and exactly one of API key or token provider                                                                                         | Configured Azure endpoint plus `/openai` when derived from endpoint                                    | Azure OpenAI authority selected by trusted operator configuration                           | Credential exclusivity and manual redirects for `api-key` requests                                                                                                                                                                                                                                                          | `src/azure.ts:86-147`, `src/azure.ts:158-214`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Bedrock client              | Bedrock bearer token and request destination                                                                        | Explicit base URL or region-derived URL; exactly one of static token or token provider                                                                                                  | Normalized Bedrock base URL                                                                            | Bedrock authority selected by trusted operator configuration                                | Credential validation, same-origin assertions, and manual redirects                                                                                                                                                                                                                                                         | `src/bedrock.ts:144-218`, `src/bedrock.ts:224-265`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Workload identity           | Kubernetes, Azure IMDS, or GCP metadata subject token exchanged for OpenAI access token                             | Operator-selected provider obtains a subject token; exchange destination is fixed                                                                                                       | Kubernetes token file or fixed cloud metadata endpoint; `https://auth.openai.com/oauth/token` exchange | Local token file or metadata service, then OpenAI token endpoint                            | Fixed exchange URL, manual redirect, token response validation, bounded metadata timeouts                                                                                                                                                                                                                                   | `src/auth/workload-identity-auth.ts:136-283`, `src/auth/subject-token-providers.ts:181-220`, `src/auth/subject-token-providers.ts:237-347`, `src/auth/subject-token-providers.ts:363-430`                                                                                                                                                                                                                                                                                                             |
| X.509 workload identity     | Certificate/private key, CONNECT proxy credentials, certificate-backed workload token, and guarded request dispatch | SDK-owned `fromX509` validates credential/proxy inputs; caller-owned transport requires explicit static-certificate attestation; X.509 fixes API origin and disallows conflicting hooks | `https://mtls.api.openai.com/v1` and fixed workload token-exchange authority                           | Approved mTLS API, workload-identity issuer, and separately scoped CONNECT proxy            | Certificate/key validation, proxy-mode validation, opaque transport capability, manual redirects, sanitized token exchange, cache/retry isolation, request snapshots, and rejection of custom fetch or dispatch overrides                                                                                                   | `src/auth/x509-transport.ts:34-55`, `src/auth/x509-transport.ts:156-358`, `src/internal/auth/x509-transport-capability.ts:52-226`, `src/internal/auth/x509-token-exchange.ts:38-310`, `src/internal/auth/x509-workload-identity-auth.ts:203-280`, `src/internal/auth/x509-workload-identity-auth.ts:497-577`, `src/internal/auth/x509-workload-identity-auth.ts:633-967`, `src/internal/auth/x509-transport-registry.ts:47-127`, `src/client.ts:536-580`, `src/internal/auth/x509-api-origin.ts:4-26` |
| Responses WebSockets        | API key when present, caller `ws` headers, queued client events, reconnect parameters, and untrusted server frames  | Public stable and beta `ws` transports derive their URL from the client and optionally reconnect with a configured queue-byte policy                                                    | Configured Responses WebSocket authority                                                               | Responses API and application event listeners                                               | Conditional bearer header applied before caller `ws` header overrides, `followRedirects: false`, immediate queue snapshots with oversized-first-message acceptance and rejection of later over-budget messages, opt-in recoverable reconnects, stale-socket suppression, iterator listener cleanup, and JSON event dispatch | `src/resources/responses/ws.ts:13-42`, `src/resources/responses/ws-base.ts:63-611`, `src/resources/beta/responses/ws.ts:13-42`, `src/resources/beta/responses/ws-base.ts:63-615`, `src/internal/ws.ts:151-185`                                                                                                                                                                                                                                                                                        |
| Upload pipeline             | Caller-controlled files, filenames, MIME types, nested fields, and lazy byte streams                                | Public `toFile` buffers compatible content; multipart routing chooses platform `FormData` or lazy streaming encoder                                                                     | Escaped multipart headers and incrementally encoded request body                                       | Resolved API authority receives multipart fields and bytes                                  | Own-property traversal, filename normalization, control-character/header escaping, validated MIME types, lazy byte iteration, and typed-multipart cancellation on unexpected streaming bodies                                                                                                                               | `src/internal/to-file.ts:93-208`, `src/internal/uploads.ts:143-225`, `src/internal/uploads.ts:234-640`, `src/internal/multipart-encoding.ts:7-53`                                                                                                                                                                                                                                                                                                                                                     |
| Webhook verification        | Webhook secret and untrusted received payload                                                                       | Explicit secret argument or client/environment secret; default tolerance is 300 seconds                                                                                                 | In-process HMAC verification of exact payload bytes                                                    | Verified event returned to application code                                                 | Required headers, secret validation, signature and timestamp verification before JSON parsing                                                                                                                                                                                                                               | `src/resources/webhooks/webhooks.ts:11-79`, `src/lib/webhook-signature.ts:88-163`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Debug diagnostics           | Request and response metadata and possibly sensitive bodies                                                         | Default `warn`; explicit `OPENAI_LOG` or `logLevel` enables debug output                                                                                                                | Caller-selected logger or console                                                                      | Operators and any downstream log sinks                                                      | Known credential headers and sensitive query values are redacted only through `formatRequestDetails`; direct streaming debug logs can expose response URL, headers, and body, so all debug metadata and bodies require controlled sinks                                                                                     | `src/client.ts:601-609`, `src/internal/utils/log.ts:85-190`, `src/internal/parse.ts:23-24`, `README.md:654-656`                                                                                                                                                                                                                                                                                                                                                                                       |
| Ordinary PR and push CI     | Checked-in repository code                                                                                          | Workflow checkout followed by checked-in bootstrap, lint, build, and test commands                                                                                                      | Ephemeral runner with `contents: read` in the visible jobs                                             | Test and build processes                                                                    | Explicit read-only workflow permissions and non-persisted checkout credentials                                                                                                                                                                                                                                              | `.github/workflows/ci.yml:18-87`, `.github/workflows/ci.yml:111-154`, `.github/workflows/codeql.yml:17-56`                                                                                                                                                                                                                                                                                                                                                                                            |
| Main-only examples CI       | Live API key                                                                                                        | Only `refs/heads/main`, repository match, non-Dependabot actor, `environment: ci`                                                                                                       | `secrets.OPENAI_API_KEY` reference                                                                     | Checked-in example and ecosystem processes                                                  | Main-only conditional and environment boundary; external environment approvals are not visible in this repository                                                                                                                                                                                                           | `.github/workflows/ci.yml:260-313`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Release job                 | GitHub App private key and write-capable app token                                                                  | Main push only, `environment: release`                                                                                                                                                  | Secret reference and short-lived token output                                                          | Token creation, pending-version helper, and release-please                                  | Pinned actions, main-only condition, environment boundary                                                                                                                                                                                                                                                                   | `.github/workflows/create-releases.yml:41-80`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| npm publication             | Immutable release artifact and OIDC publication authority                                                           | Release SHA is verified, package artifact is built separately, publisher comes from trusted workflow commit                                                                             | Downloaded `dist/` artifact; `id-token: write` only in publish job                                     | npm trusted publishing                                                                      | Immutable release checks, artifact digest mismatch failure, lifecycle-disabled publisher path                                                                                                                                                                                                                               | `.github/workflows/create-releases.yml:106-164`, `.github/workflows/create-releases.yml:240-286`, `.github/workflows/create-releases.yml:288-346`                                                                                                                                                                                                                                                                                                                                                     |
| Bedrock providers           | Dependency-free bearer provider or AWS access key, secret key, session token, profile, or credential-provider chain | Explicit provider options select one bearer or AWS credential mode and a Bedrock endpoint/region                                                                                        | Normalized configured or region-derived Bedrock endpoint                                               | Bedrock authority receives bearer or SigV4-signed request                                   | Provider-owned Authorization, endpoint/region checks, replayable-body requirement, and manual redirects                                                                                                                                                                                                                     | `src/providers/bedrock.ts:14-50`, `src/providers/bedrock/aws.ts:26-64`, `src/providers/bedrock/aws.ts:161-249`, `src/providers/bedrock/aws.ts:252-289`                                                                                                                                                                                                                                                                                                                                                |
| Stable and beta Realtime    | API key, ephemeral key, or Azure credential in a WebSocket handshake; untrusted server frames                       | Stable defaults derive from the client but trusted `buildRealtimeURL` may supply any `wss:` URL; beta requires the configured origin                                                    | Stable trusted `wss:` URL or beta matching configured `wss:` origin                                    | Configured or explicitly trusted Realtime authority; parsed events to application listeners | Stable requires `wss:`; legacy Bedrock clients additionally require the configured origin; beta requires `wss:` plus configured-origin equality; both `ws` transports protect credential redirects and both surfaces validate own string `type`                                                                             | `src/realtime/internal-base.ts:155-166`, `src/realtime/internal-base.ts:276-281`, `src/realtime/websocket.ts:204-230`, `src/internal/bedrock.ts:247-263`, `src/realtime/ws.ts:63-105`, `src/beta/realtime/websocket.ts:132-143`, `src/beta/realtime/websocket.ts:210-258`, `src/beta/realtime/ws.ts:18-28`, `src/beta/realtime/ws.ts:68-117`                                                                                                                                                          |
| Trusted Castiron reporting  | Lower-trust `workflow_run` metadata, trusted main reporter, status and PR-comment writes                            | Completed upstream custom-code workflow is checked against event, path, repository, head SHA, and current PR identity                                                                   | Main checkout plus recomputed Git-object report                                                        | Commit statuses and one PR comment                                                          | Trusted main code recomputes reports; freshness and identity checks gate writes; candidate artifacts are not trusted inputs                                                                                                                                                                                                 | `.github/workflows/castiron-custom-code-comment.yml:4-24`, `.github/workflows/castiron-custom-code-comment.yml:34-98`, `.github/workflows/castiron-custom-code-comment.yml:116-200`                                                                                                                                                                                                                                                                                                                   |
| Monthly Node version review | OpenAI API key plus repository and pull-request write authority for an automated Codex run                          | Scheduled or manual main-only workflow, `environment: ci`, fixed prompt file, workspace permission profile                                                                              | Main checkout and `codex/monthly-node-version-update` draft PR                                         | Codex action and GitHub draft-PR publisher                                                  | Main-only condition, pinned actions, `drop-sudo`, constrained add-paths, and draft PR; required human review and branch protection are external assumptions                                                                                                                                                                 | `.github/workflows/node-version-review.yml:17-55`, `.github/workflows/node-version-review.yml:90-111`                                                                                                                                                                                                                                                                                                                                                                                                 |

## 2. Threat Model, Trust Boundaries, and Assumptions

### Protected assets and objectives

- API, admin, webhook, cloud-provider, workload-identity, and certificate-backed
  credentials must reach only the authority selected by trusted operator or
  application configuration (`src/client.ts:490-518`, `src/client.ts:813-825`,
  `src/internal/auth/x509-api-origin.ts:4-26`).
- Request and response data, prompts, uploaded bytes, tool results, tenant
  selectors, and debug diagnostics must not cross tenants or leak to unintended
  destinations or sinks (`src/client.ts:878-898`, `src/internal/parse.ts:17-93`,
  `src/internal/to-file.ts:93-208`, `src/internal/uploads.ts:234-640`,
  `src/internal/utils/log.ts:85-190`).
- Webhook authenticity and freshness checks must occur before application code
  treats a payload as an authenticated event
  (`src/resources/webhooks/webhooks.ts:11-79`).
- Parsing, streaming, retries, and cancellation must preserve process
  availability and cleanup under malformed or large legitimate payloads
  (`src/internal/parse.ts:17-93`, `src/client.ts:1549-1667`).
- The official package and release credentials must remain bound to reviewed,
  protected workflow and immutable release inputs
  (`.github/workflows/create-releases.yml:106-164`,
  `.github/workflows/create-releases.yml:288-346`).

### Actors and starting capabilities

- Application users may control prompts, files, filenames, IDs, model content,
  and other values the embedding application passes into SDK methods. They do
  not inherently control client configuration, credentials, callbacks, request
  options, or transport hooks.
- API, network, webhook, SSE, WebSocket, and model outputs are lower-trust
  runtime data. They may control protocol fields and payload contents but do
  not inherently control trusted application callbacks or operator settings.
- SDK callers and operators deliberately control credentials, `baseURL`,
  providers, custom `fetch`, headers, validators, callbacks, logging sinks, and
  browser opt-in. Malicious code already executing with that application
  authority is generally not a new SDK privilege boundary.
- External contributors may propose pull-request code and metadata. They should
  not reach protected main-only examples credentials, release credentials, or
  publication authority without a separately protected transition.

### Canonical repository-code authority rule

Tracked examples, tests, fixtures, build scripts, workflow-invoked helpers, and
other executable checkout files in the exact scanned revision execute with
repository-code authority in the developer environment or workflow that runs
them. A contributor who can modify such tracked executable code does not gain a
new privilege merely because tests or builds execute it. CI directly runs
checked-in bootstrap, lint, build, test, and mock-server scripts as part of that
repository authority
(`.github/workflows/ci.yml:18-87`, `.github/workflows/ci.yml:111-154`,
`scripts/test:43-172`).

This rule is not a blanket exclusion. A real boundary remains when independently
mutable lower-trust input is parsed, evaluated, dispatched, or forwarded by
trusted repository/application code; when untrusted runtime, API, network,
webhook, stream, or model data reaches a sensitive sink; or when PR code or an
artifact crosses into protected CI, release, or publication credentials.

### Important boundaries and assumptions

- **Native audio bytes and microphone capture to subprocesses:** the public
  `openai/helpers/audio` helper streams caller- or API-controlled audio bytes
  into a spawned `ffplay` decoder, while recording spawns `ffmpeg`, buffers
  microphone output, and owns abort/process cleanup. Decoder inputs, child
  lifecycle, and retained output are distinct scan surfaces
  (`src/helpers/audio.ts:35-73`, `src/helpers/audio.ts:119-281`).
- **Azure token providers to browser exposure:** supplying an
  `azureADTokenProvider` implicitly enables `dangerouslyAllowBrowser` only
  when the caller did not provide a value; an explicit `false` remains the
  denial control. This differs from ordinary clients' explicit browser opt-in
  prerequisite (`src/azure.ts:86-147`).
- **Terminal API errors to application sinks:** terminal non-2xx responses are
  read regardless of log level, and `APIError` retains parsed error content,
  raw response headers, and a server-influenced message. Applications that
  forward exceptions must treat these always-on diagnostics as sensitive
  (`src/client.ts:1421-1446`, `src/core/error.ts:6-50`).
- **Ordinary stream lifecycle:** `stream: true` responses flow through
  `defaultParseResponse` into shared
  `Stream.fromSSEResponse`. That SSE path creates streaming `APIError` values,
  supports tee buffering and `ReadableStream` conversion, and owns early-break
  aborts, reader cancellation, and lock release; the same owner separately
  exposes NDJSON parsing through `Stream.fromReadableStream`
  (`src/internal/parse.ts:17-93`, `src/core/streaming.ts:88-456`).
- **Raw-response promises to body ownership and identity:** root-exported
  `APIPromise` exposes `asResponse()` and `withResponse()`, memoizes parsed
  bodies, and retains raw response headers for callers; the client overrides
  response ordering so body-timeout retries report the final attempt. Raw-body
  ownership, cleanup, header exposure, and wrong-attempt identity remain scan
  surfaces (`src/core/api-promise.ts:15-98`, `src/client.ts:970-992`).
- **Incomplete stream events, replay, and public snapshots to callbacks:**
  `AssistantStream`, `ChatCompletionStream`, public `responses.stream()`,
  and the public/internal Responses accumulators consume partial SSE events,
  mutate and expose snapshots, bind event/tool-call identities, and decide
  callback timing. `ResponseStream` replays and locally filters SSE while
  preserving complete snapshots; shared `EventStream` owns buffering,
  iterator cancellation, listener cleanup, and terminal-error propagation.
  Sparse indexes, prototype keys, cross-event identity, retention, cancellation,
  and callback confusion remain scan surfaces
  (`src/resources/responses/responses.ts:203-207`,
  `src/lib/AssistantStream.ts:1-1022`,
  `src/lib/ChatCompletionStream.ts:1-2545`,
  `src/lib/responses/ResponseStream.ts:24-317`,
  `src/lib/EventStream.ts:1331-1982`,
  `src/lib/responses/ResponseAccumulator.ts:1-27`,
  `src/internal/responses/response-accumulator.ts:1-1232`).
- **Zod schemas to serialized contracts and parsed callbacks:** the public
  `openai/helpers/zod` integration covers Zod v3, v4, and v4 Mini through
  strict-schema conversion, local-reference handling, vendored JSON Schema
  conversion, serialization, parsed output, and optional tool callbacks. These
  paths are distinct from Standard Schema validation
  (`src/helpers/zod.ts:1-474`,
  `src/helpers/zod-v3-strict-schema.ts:1-514`,
  `src/lib/transform.ts:1-2072`,
  `src/_vendor/zod-to-json-schema/zodToJsonSchema.ts:1-194`,
  `src/_vendor/zod-to-json-schema/Refs.ts:1-48`).
- **Embedding strings to expanded numeric arrays:** unless callers explicitly
  select an encoding, public embeddings requests ask for base64 on the wire,
  decode each server-controlled string into a JavaScript number array, and
  mutate the parsed response. Malformed alignment and large-response expansion
  remain post-parse availability and integrity surfaces
  (`src/lib/embeddings.ts:17-65`, `src/internal/utils/base64.ts:45-61`).
- **Polling helpers to repeated requests and timers:** public polling helpers
  accept server-controlled `openai-poll-after-ms` without the ordinary
  transport retry path's 60-second bound, generally have no overall deadline,
  and immediately repeat unknown statuses. Caller abort signals can interrupt
  waits, but loop duration, request amplification, and cancellation remain scan
  surfaces (`src/lib/polling.ts:94-144`).
- **Auto-pagination to response-driven request loops:** `PagePromise`
  delegates async iteration to `AbstractPage`; `AbstractPage.getNextPage()`
  issues another authenticated request when server-controlled `has_more` and
  cursor fields indicate a next page. Async iteration has no overall deadline
  or repeated-cursor guard, so amplification, cancellation, and retained-page
  behavior are distinct from polling helpers
  (`src/core/pagination.ts:29-61`, `src/core/pagination.ts:73-111`,
  `src/core/pagination.ts:155-328`).
- **Caller headers to normalized authentication precedence:** shared
  `buildHeaders` owns record-versus-array behavior, source precedence,
  explicit-null removal, case folding, token-name validation, and omission
  semantics used by REST, provider, webhook, and X.509 paths. Header injection,
  inherited-property, and credential-override defects remain central scan
  surfaces (`src/internal/headers.ts:29-94`, `src/client.ts:773-825`,
  `src/azure.ts:212-212`, `src/bedrock.ts:255-255`,
  `src/resources/webhooks/webhooks.ts:48-48`,
  `src/internal/auth/x509-workload-identity-auth.ts:285-295`).
- **Caller configuration to network and credential sink:** ordinary clients
  intentionally allow trusted callers to select destinations, headers, custom
  transports, and providers. A finding requires a lower-trust actor to control
  those values or a promised restriction to be bypassed
  (`src/client.ts:505-612`, `src/client.ts:878-898`,
  `src/client.ts:1524-1587`).
- **Data-residency selection to regional API authority:** `dataResidency`
  intentionally selects a fixed `global`, `us`, `eu`, or `ae` OpenAI API
  root that receives credentials and request data. Constructor and clone logic
  preserve this promised routing restriction and reject conflicts with
  `baseURL`, providers, Azure, Bedrock, and X.509 identity
  (`src/internal/data-residency.ts:6-44`, `src/client.ts:505-571`,
  `src/client.ts:648-727`, `src/azure.ts:86-100`,
  `src/bedrock.ts:144-158`).
- **Provider and workload credentials to their authorities:** Azure, Bedrock,
  Kubernetes token-file, Azure IMDS, GCP metadata, and workload token-exchange
  paths have distinct credential sources and destination controls. Treat an
  attacker-controlled provider option, token path, or custom metadata fetch as
  trusted operator configuration unless a lower-trust actor can independently
  influence it; origin, redirect, cache, and token-validation bypasses remain
  real boundaries (`src/azure.ts:86-214`, `src/bedrock.ts:144-265`,
  `src/auth/workload-identity-auth.ts:136-283`,
  `src/auth/subject-token-providers.ts:181-220`,
  `src/auth/subject-token-providers.ts:237-347`,
  `src/auth/subject-token-providers.ts:363-430`).
- **X.509 certificate, proxy, token, and request scope:** the public
  `openai/auth/x509-transport` entrypoint either validates SDK-owned
  certificate/private-key and CONNECT-proxy configuration or accepts an
  explicitly attested static-certificate transport. Internal capability,
  exchange, registry, and authentication owners preserve HTTPS/manual redirects,
  fixed issuer/API destinations, sanitized token responses, complete cache
  identity, retries, and per-request isolation
  (`src/auth/x509-transport.ts:34-55`,
  `src/auth/x509-transport.ts:156-358`,
  `src/internal/auth/x509-transport-capability.ts:52-226`,
  `src/internal/auth/x509-token-exchange.ts:38-310`,
  `src/internal/auth/x509-workload-identity-auth.ts:203-280`,
  `src/internal/auth/x509-workload-identity-auth.ts:497-577`,
  `src/internal/auth/x509-workload-identity-auth.ts:633-967`,
  `src/internal/auth/x509-transport-registry.ts:47-127`).
- **Stable and beta Realtime handshakes to event dispatch:** native and `ws`
  transports separately construct credential-bearing WebSocket connections and
  parse untrusted server frames. Stable defaults derive from the client, but a
  trusted `buildRealtimeURL` hook may supply any `wss:` URL; legacy Bedrock
  clients additionally receive configured-origin checks. Beta separately
  enforces `wss:` plus configured-origin equality, while both `ws` transports
  protect credential redirects. Browser, Azure-header, redirect, and
  event-shape checks remain transport-specific scan
  surfaces (`src/realtime/internal-base.ts:155-166`,
  `src/realtime/internal-base.ts:276-281`,
  `src/realtime/websocket.ts:204-230`, `src/internal/bedrock.ts:247-263`,
  `src/realtime/ws.ts:63-105`,
  `src/beta/realtime/websocket.ts:132-143`,
  `src/beta/realtime/websocket.ts:210-258`,
  `src/beta/realtime/ws.ts:18-28`, `src/beta/realtime/ws.ts:68-117`).
- **Stable and beta Responses WebSockets to event dispatch:** public stable
  and beta `ws` transports independently create handshakes that conditionally
  add bearer auth before caller `ws` header overrides and disable redirects.
  During optional reconnects their queues snapshot data immediately, accept an
  oversized first message, and reject later messages that exceed the configured
  byte policy; they suppress stale-socket transitions, clean up iterator
  listeners, and dispatch untrusted JSON server events
  (`src/resources/responses/ws.ts:13-42`,
  `src/resources/responses/ws-base.ts:63-611`,
  `src/resources/beta/responses/ws.ts:13-42`,
  `src/resources/beta/responses/ws-base.ts:63-615`,
  `src/internal/ws.ts:151-185`).
- **Untrusted response or model data to parsers and callbacks:** JSON, SSE,
  WebSocket, structured-output, and tool-argument data remain lower-trust even
  when carried by an expected service. Chat runners may invoke only
  caller-supplied callbacks after parsing and matching; callback authorization
  remains the embedding application's responsibility
  (`src/internal/parse.ts:17-93`, `src/lib/parser.ts:162-184`,
  `src/helpers/standard-schema.ts:703-805`,
  `src/lib/AbstractChatCompletionRunner.ts:446-499`).
- **Caller-controlled uploads to multipart request body:** `toFile`, buffered
  `FormData`, typed multipart fields, and the lazy streaming encoder own file
  materialization, filename/path normalization, nested own-property traversal,
  header escaping, MIME validation, byte iteration, and cancellation-sensitive
  cleanup. These remain scan surfaces even when the destination is trusted
  (`src/internal/to-file.ts:93-208`, `src/internal/uploads.ts:143-225`,
  `src/internal/uploads.ts:234-640`,
  `src/internal/multipart-encoding.ts:7-53`).
- **Webhook ingress to application business logic:** signature verification
  authenticates the payload, but application deduplication, tenant mapping, and
  business authorization remain caller obligations
  (`src/resources/webhooks/webhooks.ts:11-79`).
- **PR code to ordinary CI:** visible PR/push jobs use read-only contents
  permissions and execute repository code; this is not itself a privilege
  escalation (`.github/workflows/ci.yml:18-154`,
  `.github/workflows/codeql.yml:17-56`).
- **Protected main or release input to credentials:** main-only examples and
  release/publication jobs possess capabilities unavailable to ordinary PR
  execution. Branch protection, GitHub environment approvals, and npm trusted
  publisher configuration are external assumptions not provable from this
  checkout (`.github/workflows/ci.yml:260-313`,
  `.github/workflows/create-releases.yml:41-80`,
  `.github/workflows/create-releases.yml:288-346`).
- **Workflow metadata or automation prompts to privileged writes:** the
  trusted Castiron comment workflow consumes lower-trust `workflow_run` state
  before writing statuses and PR comments, while the monthly Node review gives
  an automated Codex run an API key and repository/PR write authority. Their
  main-only code, freshness/identity checks, constrained paths, and draft
  status are repository-visible controls; required human review and branch
  protection are external assumptions
  (`.github/workflows/castiron-custom-code-comment.yml:4-24`,
  `.github/workflows/castiron-custom-code-comment.yml:116-200`,
  `.github/workflows/node-version-review.yml:17-55`,
  `.github/workflows/node-version-review.yml:90-111`).
- **Dependencies to build execution:** frozen lockfiles and workspace dependency
  policy reduce supply-chain risk, but dependency lifecycle behavior remains a
  real boundary when independently mutable artifacts can reach a trusted build
  (`.github/CONTRIBUTING.md:77-91`, `pnpm-workspace.yaml:7-37`).

## 3. Attack Surface, Mitigations, and Attacker Stories

| Priority                 | Scenario and capability gain                                                                                                                                                   | Prerequisites                                                                                                                                                             | Impact                                                                                            | Existing controls                                                                                                                                                                                                                        | Mitigation                                                                                                                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| High                     | A lower-trust value controls a request destination, redirect, header, or transport and receives a usable credential or sensitive request body.                                 | An application exposes trusted request options or a promised restricted transport is bypassed; merely choosing a custom endpoint as operator configuration is not enough. | Credential or data disclosure to another authority.                                               | Default or residency-selected OpenAI URL, explicit browser opt-in, stricter X.509 origin and hook restrictions.                                                                                                                          | Keep configuration operator-owned; preserve residency, origin, and redirect checks on credential-bearing paths.                                                                              | `src/client.ts:505-612`, `src/client.ts:878-898`, `src/client.ts:1524-1587`, `src/internal/data-residency.ts:6-44`, `src/internal/auth/x509-api-origin.ts:4-26`                                                                                                                                                                                                                                                                            |
| High                     | An unauthenticated webhook payload is accepted and reaches application business logic as authentic.                                                                            | Internet caller reaches an application webhook handler and the SDK verifier is used normally.                                                                             | Forged event-driven mutation or disclosure.                                                       | Required headers, nonempty secret, HMAC/timestamp verification before parsing.                                                                                                                                                           | Preserve verification-before-parse; callers must deduplicate and authorize local actions.                                                                                                    | `src/resources/webhooks/webhooks.ts:11-79`, `src/lib/webhook-signature.ts:88-163`                                                                                                                                                                                                                                                                                                                                                          |
| High                     | Untrusted API, stream, WebSocket, or model output crosses parser state into prototype pollution, tenant confusion, or an unintended privileged callback.                       | Attacker controls a real protocol payload or model/tool argument, not merely trusted callback code.                                                                       | Cross-request state corruption, unauthorized callback effects, or sensitive data exposure.        | Structured validators, parser checks, WebSocket event dispatch boundaries, and callback allowlisting; callbacks are supplied by the application.                                                                                         | Preserve own-property validation, schema boundaries, iteration limits, event cleanup, and application-level authorization inside callbacks.                                                  | `src/internal/parse.ts:17-93`, `src/resources/responses/ws-base.ts:194-611`, `src/resources/beta/responses/ws-base.ts:198-615`, `src/lib/parser.ts:162-184`, `src/helpers/standard-schema.ts:703-805`, `src/lib/AbstractChatCompletionRunner.ts:446-499`                                                                                                                                                                                   |
| Medium                   | Malformed or very large legitimate response, stream, upload, WebSocket, pagination, or embedding data causes disproportionate CPU, memory, retention, or cancellation failure. | Lower-trust runtime data reaches a parser, accumulator, decoder, polling loop, pagination loop, or base64 expansion used by a long-lived process.                         | Worker availability degradation without credential compromise.                                    | Ordinary HTTP retry hints are bounded; shared streams own cancellation cleanup; uploads support incremental encoding and typed-multipart cleanup; polling and pagination expose caller cancellation but commonly lack overall deadlines. | Prefer incremental, amortized-linear processing and timely cleanup; callers impose service-level budgets where needed. Do not add arbitrary limits that reject supported large API payloads. | `src/internal/parse.ts:17-93`, `src/core/streaming.ts:88-456`, `src/client.ts:1549-1667`, `src/lib/polling.ts:94-144`, `src/core/pagination.ts:29-61`, `src/core/pagination.ts:155-328`, `src/lib/embeddings.ts:17-65`, `src/internal/utils/base64.ts:45-61`, `src/helpers/audio.ts:35-73`, `src/helpers/audio.ts:119-281`, `src/internal/to-file.ts:93-208`, `src/internal/uploads.ts:203-640`, `src/internal/multipart-encoding.ts:7-53` |
| High                     | An external PR or mutable artifact reaches main-only API keys, release GitHub App credentials, or npm OIDC publication authority.                                              | Protected branch/environment or immutable artifact binding is bypassed; ordinary read-only PR CI is insufficient.                                                         | Credential theft or publication of attacker-controlled official packages.                         | PR jobs use read-only contents; releases are main-only; release SHA and artifacts are verified; publisher script is preserved from trusted workflow code.                                                                                | Keep privileged workflows bound to protected, immutable revisions and maintain least-privilege permissions.                                                                                  | `.github/workflows/ci.yml:18-154`, `.github/workflows/ci.yml:260-313`, `.github/workflows/create-releases.yml:41-80`, `.github/workflows/create-releases.yml:106-164`, `.github/workflows/create-releases.yml:288-346`                                                                                                                                                                                                                     |
| Not a boundary by itself | A contributor changes a tracked test, fixture, example, build script, or workflow-invoked helper and that repository code executes during its normal build or test workflow.   | The same actor already controls the tracked executable code being run.                                                                                                    | No new capability solely from execution of code already entrusted with repository-code authority. | Code review and the workflow's existing permission boundary.                                                                                                                                                                             | Re-evaluate only if independently mutable input or a protected credential transition is present.                                                                                             | `.github/workflows/ci.yml:18-154`, `scripts/test:43-172`, `.github/CONTRIBUTING.md:103-117`                                                                                                                                                                                                                                                                                                                                                |
| High                     | Lower-trust workflow metadata, candidate artifacts, or automation output controls a privileged status, PR-comment, repository-write, or draft-PR action.                       | A trusted workflow fails to bind its write to validated event, repository, revision, identity, or allowed paths.                                                          | Attacker-controlled statuses, comments, or repository changes.                                    | Castiron recomputes with trusted main code and checks freshness; monthly Node review is main-only and constrained to draft PR paths; required human review and branch protection are external assumptions.                               | Preserve immutable trusted-code, event identity, freshness, path, and externally enforced review gates.                                                                                      | `.github/workflows/castiron-custom-code-comment.yml:4-24`, `.github/workflows/castiron-custom-code-comment.yml:116-200`, `.github/workflows/node-version-review.yml:17-55`, `.github/workflows/node-version-review.yml:90-111`                                                                                                                                                                                                             |

## 4. Severity Calibration

- **Critical:** a realistic unauthenticated or lower-trust actor gains broad
  cross-user compromise, arbitrary code execution in a normally configured SDK
  consumer without an intentionally dangerous callback, or control of official
  publication through a protected release-boundary failure. A contributor merely
  changing tracked executable repository code is not critical by itself.
- **High:** usable credential disclosure across a promised origin boundary,
  normal-use webhook forgery, cross-tenant data or token confusion, meaningful
  authorization consequences from parser corruption, or PR/artifact content
  reaching protected CI/release credentials.
- **Medium:** reachable, disproportionate process-level denial of service,
  bounded sensitive diagnostic leakage, or parser/callback confusion whose impact
  depends on a specific application integration.
- **Low:** malformed lower-trust input that fails only its own request cleanly,
  nonsecret metadata disclosure, or an edge case limited to explicitly enabled
  developer tooling.

Severity requires a reachable lower-trust source, a violated boundary, and a
meaningful capability gain. Deliberately selecting an attacker-controlled
`baseURL`, custom transport, logger, or callback; exposing long-lived browser
credentials with explicit opt-in; or modifying one's own tracked executable
repository code is ordinary trusted configuration or repository authority unless
another actor independently crosses a boundary described above.
