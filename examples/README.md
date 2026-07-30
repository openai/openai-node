# OpenAI Node.js examples

This directory contains handwritten examples for supported SDK and API behavior. Start with
[`demo.ts`](./demo.ts) for a minimal request, then use the catalog below to find a focused example.
Paths are intentionally stable so existing links continue to work.

## Setup

From the repository root:

```sh
pnpm install
export OPENAI_API_KEY="your-api-key"
pnpm tsn examples/demo.ts
```

Most examples use `OPENAI_API_KEY`. Azure Chat and Responses examples use
`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and a credential supported by
`@azure/identity`. Azure Realtime uses `AZURE_OPENAI_ENDPOINT` and Azure identity, with
the deployment configured in the example source. The legacy Azure Assistants example uses
`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `OPENAI_API_VERSION`, and
`AZURE_OPENAI_DEPLOYMENT`. The Bedrock example uses the standard AWS credential chain. Examples
with extra local requirements call them out in the catalog.

For every directly runnable entry, use the same command shape:

```sh
pnpm tsn examples/<path>.ts
```

`current` examples cover supported SDK behavior. `preview` examples require a beta API surface.
`deprecated` examples are retained for existing integrations and should not be the starting point
for new work. The machine-readable inventory in [`manifest.json`](./manifest.json) records each
example's API family, runtime, credentials, dependencies, lifecycle, and exact command.

## Getting started

| Example                                          | What it demonstrates                        | API              | Runtime | Lifecycle |
| ------------------------------------------------ | ------------------------------------------- | ---------------- | ------- | --------- |
| [`demo.ts`](./demo.ts)                           | Minimal non-streaming and streaming request | Chat Completions | Node.js | current   |
| [`errors.ts`](./errors.ts)                       | Typed API error handling                    | SDK errors       | Node.js | current   |
| [`raw-response.ts`](./raw-response.ts)           | Raw HTTP response access                    | Completions      | Node.js | current   |
| [`types.ts`](./types.ts)                         | Explicit request and response types         | Chat Completions | Node.js | current   |
| [`chat-params-types.ts`](./chat-params-types.ts) | Chat parameter type narrowing               | Chat Completions | Node.js | current   |

## Responses API

| Example                                                                              | What it demonstrates                               | Runtime        | Lifecycle |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------- | --------- |
| [`responses/manual-conversation-state.ts`](./responses/manual-conversation-state.ts) | Manually carrying conversation state between turns | Node.js        | current   |
| [`responses/stream.ts`](./responses/stream.ts)                                       | Streaming response events                          | Node.js        | current   |
| [`responses/stream_background.ts`](./responses/stream_background.ts)                 | Streaming a background response                    | Node.js        | current   |
| [`responses/streaming-tools.ts`](./responses/streaming-tools.ts)                     | Streaming tool calls with Zod                      | Node.js, `zod` | current   |
| [`responses/structured-outputs.ts`](./responses/structured-outputs.ts)               | Parsing structured text output                     | Node.js, `zod` | current   |
| [`responses/structured-outputs-tools.ts`](./responses/structured-outputs-tools.ts)   | Structured tool calls                              | Node.js, `zod` | current   |
| [`responses/websocket.ts`](./responses/websocket.ts)                                 | Responses over WebSocket                           | Node.js, `ws`  | current   |
| [`responses/multi-agent-streaming.ts`](./responses/multi-agent-streaming.ts)         | Streaming multi-agent responses                    | Node.js        | preview   |
| [`responses/multi-agent-websocket.ts`](./responses/multi-agent-websocket.ts)         | Multi-agent responses over WebSocket               | Node.js, `ws`  | preview   |

## Tools and structured output

| Example                                                        | What it demonstrates                  | API              | Dependencies |
| -------------------------------------------------------------- | ------------------------------------- | ---------------- | ------------ |
| [`function-call.ts`](./function-call.ts)                       | Chat Completions function calls       | Chat Completions | none         |
| [`function-call-diy.ts`](./function-call-diy.ts)               | Manual function-call orchestration    | Chat Completions | none         |
| [`function-call-stream.ts`](./function-call-stream.ts)         | Streaming function calls with helpers | Chat Completions | none         |
| [`function-call-stream-raw.ts`](./function-call-stream-raw.ts) | Raw streamed function-call chunks     | Chat Completions | none         |
| [`tool-call-helpers.ts`](./tool-call-helpers.ts)               | SDK tool-running helpers              | Chat Completions | none         |
| [`tool-call-helpers-zod.ts`](./tool-call-helpers-zod.ts)       | Schema-validated tool calls           | Chat Completions | `zod`        |
| [`tool-calls-stream.ts`](./tool-calls-stream.ts)               | Raw streamed tool-call inspection     | Chat Completions | none         |
| [`parsing.ts`](./parsing.ts)                                   | Structured chat output parsing        | Chat Completions | `zod`        |
| [`parsing-stream.ts`](./parsing-stream.ts)                     | Streaming parsed chat output          | Chat Completions | `zod`        |
| [`parsing-tools.ts`](./parsing-tools.ts)                       | Parsed tool arguments                 | Chat Completions | `zod`        |
| [`parsing-tools-stream.ts`](./parsing-tools-stream.ts)         | Streamed parsed tool arguments        | Chat Completions | `zod`        |
| [`parsing-run-tools.ts`](./parsing-run-tools.ts)               | Running parsed tools                  | Chat Completions | `zod`        |
| [`ui-generation.ts`](./ui-generation.ts)                       | Generating typed UI data              | Chat Completions | `zod`        |

## Streaming and frameworks

| Example                                                        | What it demonstrates                  | Runtime            | Extra setup                     |
| -------------------------------------------------------------- | ------------------------------------- | ------------------ | ------------------------------- |
| [`stream.ts`](./stream.ts)                                     | Chat Completions streaming helper     | Node.js            | none                            |
| [`logprobs.ts`](./logprobs.ts)                                 | Streamed log probabilities            | Node.js            | none                            |
| [`stream-to-client-express.ts`](./stream-to-client-express.ts) | Forwarding a stream through Express   | Express server     | `express`                       |
| [`stream-to-client-raw.ts`](./stream-to-client-raw.ts)         | Forwarding plain text through Express | Express server     | `express`                       |
| [`stream-to-client-browser.ts`](./stream-to-client-browser.ts) | Consuming a server stream             | Browser-compatible | Run a stream server first       |
| [`stream-to-client-next.ts`](./stream-to-client-next.ts)       | Next.js route handler reference       | Next.js route      | Copy into a Next.js application |

## Audio, images, and fine-tuning

| Example                                    | What it demonstrates                | API         | Extra setup                       |
| ------------------------------------------ | ----------------------------------- | ----------- | --------------------------------- |
| [`audio.ts`](./audio.ts)                   | Speech generation and transcription | Audio       | none                              |
| [`speech-to-text.ts`](./speech-to-text.ts) | Recording and transcribing speech   | Audio       | Audio input device                |
| [`text-to-speech.ts`](./text-to-speech.ts) | Generating and playing speech       | Audio       | Audio output device               |
| [`image-stream.ts`](./image-stream.ts)     | Streaming generated images          | Images      | none                              |
| [`picture.ts`](./picture.ts)               | Image generation and editing        | Images      | Optional image paths as arguments |
| [`fine-tuning.ts`](./fine-tuning.ts)       | Uploading data and creating a job   | Fine-tuning | Included `fine-tuning-data.jsonl` |

## Realtime

| Example                                            | What it demonstrates          | Runtime                | Dependencies |
| -------------------------------------------------- | ----------------------------- | ---------------------- | ------------ |
| [`realtime/websocket.ts`](./realtime/websocket.ts) | Web-standard WebSocket client | Web-standard WebSocket | none         |
| [`realtime/ws.ts`](./realtime/ws.ts)               | Node.js `ws` client           | Node.js                | `ws`         |

## Azure OpenAI

Chat and Responses require `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and an
Azure credential. Realtime uses `AZURE_OPENAI_ENDPOINT` and Azure identity; set
`deploymentName` in the example source for your deployment.

| Example                                                        | What it demonstrates                       | API              | Dependencies            |
| -------------------------------------------------------------- | ------------------------------------------ | ---------------- | ----------------------- |
| [`azure/chat.ts`](./azure/chat.ts)                             | Chat Completions through Azure OpenAI      | Chat Completions | `@azure/identity`       |
| [`azure/responses.ts`](./azure/responses.ts)                   | Responses through Azure OpenAI             | Responses        | `@azure/identity`       |
| [`azure/realtime/websocket.ts`](./azure/realtime/websocket.ts) | Azure Realtime with Web-standard WebSocket | Realtime         | `@azure/identity`       |
| [`azure/realtime/ws.ts`](./azure/realtime/ws.ts)               | Azure Realtime with the `ws` package       | Realtime         | `@azure/identity`, `ws` |

## Amazon Bedrock

| Example                                          | What it demonstrates             | Runtime | Dependencies    |
| ------------------------------------------------ | -------------------------------- | ------- | --------------- |
| [`bedrock/responses.ts`](./bedrock/responses.ts) | Responses through Amazon Bedrock | Node.js | AWS credentials |

## Legacy Assistants

The Assistants API is deprecated and shuts down on August 26, 2026. These examples remain available
for existing integrations; use the Responses API examples above for new work.
The Azure sample uses `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`,
`OPENAI_API_VERSION`, and `AZURE_OPENAI_DEPLOYMENT`.

| Example                                                | What it demonstrates                    | Runtime | Lifecycle  |
| ------------------------------------------------------ | --------------------------------------- | ------- | ---------- |
| [`assistants.ts`](./assistants.ts)                     | Polling an Assistants run               | Node.js | deprecated |
| [`assistant-stream.ts`](./assistant-stream.ts)         | Streaming an Assistants run             | Node.js | deprecated |
| [`assistant-stream-raw.ts`](./assistant-stream-raw.ts) | Inspecting raw Assistants stream events | Node.js | deprecated |
| [`azure/assistants.ts`](./azure/assistants.ts)         | Azure OpenAI Assistants                 | Node.js | deprecated |

## Maintaining the catalog

When adding, removing, or renaming an example, update both this README and
[`manifest.json`](./manifest.json), then run:

```sh
pnpm check:examples
```

The check verifies that every TypeScript example has exactly one manifest entry, every manifest path
exists, every runnable command follows the repository convention, and every entry is linked here.
