# Agents session helpers

`client.beta.agents.sessions.stream()` submits input to an idle session and returns a single-use async iterable. Iteration opens the event subscription before submitting input. The session must have a single input writer while the helper runs because the input endpoint does not return a turn ID.

```ts
import OpenAI from 'openai';
import { outputText } from 'openai/lib/agents/output-text';

const client = new OpenAI();
const session = await client.beta.agents.sessions.create({ environment: { type: 'none' } });
const stream = client.beta.agents.sessions.stream(session.id, {
  input: 'What is 2 + 2?',
});

for await (const event of stream) {
  if (event.type === 'agent.session.turn.item.done' && event.item.type === 'message') {
    console.log(outputText(event.item));
  }
}
```

`outputText(message)` joins that message's `output_text` content blocks in order. It works on messages from streaming events and REST results, preserves both commentary and final-answer phases, and does not modify or fetch anything.

## Collect a final answer (beta)

Call `finalResult()` on streamed creation with initial input or a follow-up to collect the completed turn's final answer.

```ts
const stream = await client.beta.agents.sessions.create({
  agent: { model: 'gpt-5', instructions: 'Explain the policy clearly.' },
  environment: { type: 'none' },
  input: 'Summarize the policy.',
  stream: true,
});
const result = await stream.finalResult();
console.log(result.output_text);
console.log(result.session_id, result.turn_id, result.turn.usage);

const followup = client.beta.agents.sessions
  .stream(result.session_id, {
    input: 'Give an example.',
  })
  .withResultCollection();
for await (const event of followup) console.log(event.type);
console.log((await followup.finalResult()).output_text);
```

Call `stream.withResultCollection()` before iterating progress if you also want a final result; calling `finalResult()` directly enables collection automatically. Raw iteration retains no result messages. Repeated getters reuse the result. As with other streams, breaking out of iteration closes observation. `result.messages` preserves the final messages and annotations, and `result.turn` includes the turn's status and usage.

Optional `toolHandlers` map configured function names to callbacks. Each callback receives a detached argument object and may return text, a JSON object, an array of supported input content, `null`, or a promise for one of those values. Callbacks run sequentially during iteration, after their original call event is yielded. Unregistered functions are left for manual handling through the raw events API. Invalid arguments and callback failures submit a generic failure result without exception text.

```ts
const stream = client.beta.agents.sessions.stream(session.id, {
  input: 'Use the configured add function to add 2 and 2.',
  toolHandlers: {
    add: async (args) => ({ sum: Number(args.a) + Number(args.b) }),
  },
});
for await (const event of stream) {
  console.log(event.type);
}
```

Register the corresponding function on the agent before using a handler. Each input and tool-result submission uses a distinct idempotency key preserved across retries. `idempotencyKey` applies to input only; a case-insensitive `Idempotency-Key` request header takes precedence. Request options are passed as the third argument.

The first coordinator `turn.created` event selects the turn. Initial idle events and subagent completions do not terminate iteration. After that turn completes, fails, or is cancelled, the helper waits for `session.idle`; `session.failed` also terminates. These terminal events remain visible, while an unexpected connection end throws.

Break out of `for await`, call `stream.abort()`, or pass a request `signal` to close local requests. This does not cancel the backend turn. Cancellation interrupts waiting for an asynchronous handler but cannot undo work the callback already started. For observing an active session without submitting input, use `client.beta.agents.sessions.events.stream()`.

## Typed application tools (beta)

Use `functionTool()` with `zodResponsesFunction()` or `standardResponsesFunction()` to share a schema and callback between the hosted definition and local execution. Arguments are validated before your callback runs. Bind application services through closures or bound methods.

```ts
import { z } from 'zod';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { functionTool } from 'openai/lib/beta/agents/function-tool';

const lookup = functionTool(
  zodResponsesFunction({
    name: 'lookup_item',
    description: 'Look up a catalog item.',
    parameters: z.object({ item_id: z.string() }),
    function: ({ item_id }) => catalog.lookup(item_id),
  }),
);
// Use this agent configuration when creating your session.
const agent = { model: MODEL, tools: [lookup.definition] };

// Attach the local handler once the configured session is idle.
const stream = client.beta.agents.sessions.stream(SESSION_ID, {
  input: 'Look up catalog item ITEM_A.',
  toolHandlers: { [lookup.name]: lookup.handler },
});
for await (const event of stream) {
  console.log(event.type);
}
```

Reuse the handler with an existing idle session whose agent already has the matching definition. Raw handlers can share the same `toolHandlers` map.

### Typed final output (beta)

Bind a Zod v3/v4/Mini object schema to creation and its final result:

```ts
import { z } from 'zod';
import { zodAgentTextFormat } from 'openai/helpers/beta/agents/zod';

const format = zodAgentTextFormat(z.object({ summary: z.string() }));
const stream = await client.beta.agents.sessions.create({
  agent: { model: 'gpt-6-astra', text: { format } },
  environment: { type: 'none' },
  input: 'Summarize the notes.',
  stream: true,
});
const result = await stream.finalResult();
console.log(result.output_parsed.summary);

const followup = client.beta.agents.sessions.stream(result.session_id, {
  input: 'Make it shorter.',
  outputFormat: format,
});
console.log((await followup.finalResult()).output_parsed.summary);
```

Follow-up `outputFormat` only chooses the local parser; the session must already use
that schema. `standardAgentTextFormat` from
`openai/helpers/beta/agents/standard-schema` supports synchronous Standard Schema
validators; `agentOutputFormat(schema, parse)` supports other validators.
`output_parsed` contains the first parsed final text part; every final text part is validated.
`AgentOutputParseError.raw_result` preserves completed raw output if parsing fails.

### Stage files and download a report (beta)

```ts
import { agentFileDestination, prepareAgentDirectory } from 'openai/helpers/beta/agents/filesystem';

const files = client.beta.agents.environments.files;
const prepared = await prepareAgentDirectory(files, './documents', {
  include: ['source.pdf', 'notes.txt'],
  to: '/workspace/documents',
});
const stream = await client.beta.agents.sessions.create({
  agent: { model: 'gpt-6-astra' },
  environment: { type: 'openai_hosted', files: prepared.files },
  input: 'Read the documents and write /workspace/outputs/report.md.',
  stream: true,
});
const result = await stream.finalResult();
await client.beta.agents.sessions.artifacts.forResult(result).download({
  path: '/workspace/outputs/report.md',
  to: agentFileDestination('./report.md'),
});
```

To read the report into memory, use the native response:

```ts
const report = client.beta.agents.sessions.artifacts.forResult(result);
const bytes = await (await report.content('/workspace/outputs/report.md')).arrayBuffer();
```

`agentFileDestination` assumes an application-owned safe path whose parent directory
stays stable during the download. To control file opening yourself, pass your own
`WritableStream` to `download` instead.

For a connected environment, stage another file directly:

```ts
import { agentFile } from 'openai/helpers/beta/agents/filesystem';

await files.upload(environmentId, {
  file: await agentFile('./extra.txt'),
  path: '/workspace/extra.txt',
});
```

For existing upload inputs, call `files.prepare({ '/workspace/source.pdf': file })`.
Downloads also accept ordinary web `WritableStream` destinations. Uploaded files
remain caller-owned: `prepared.uploadedFiles` and `AgentFileUploadError.uploadedFiles`
expose them for explicit Files API cleanup. Directory preparation stages only the
selected files once; it does not synchronize a directory.

Local path and directory uploads assume application-owned paths and stable source
directories. They are convenience helpers, not a filesystem sandbox; file contents
may be user-provided.
