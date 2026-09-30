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

Streamed creation and the follow-up helper both expose `finalResult()`. It consumes the existing stream through the selected root turn's completion and subsequent idle event, then returns that turn and its completed final assistant messages:

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

const followup = client.beta.agents.sessions.stream(result.session_id, {
  input: 'Give an example.',
});
console.log((await followup.finalResult()).output_text);
```

To display progress, iterate the follow-up stream before calling the getter. Events already consumed contribute to the same result. Repeated calls return the cached result and do not submit input or run handlers again. Do not consume the stream concurrently from multiple readers.

`result.messages` preserves message boundaries and annotations. `output_text` joins their text without extra separators and may be empty for a successful text-free turn. Commentary and subagent answers are excluded. The result uses the generated turn and message types; it is not a full session transcript.

A creation stream retains its normal raw iteration behavior, which may continue beyond one turn. Calling `finalResult()` stops local observation at the selected turn's idle boundary; it does not cancel hosted execution. Existing response/header access, `controller`, `tee()` and `toReadableStream()` remain available.

`AgentTurnResultError`, imported from `openai/lib/beta/agents/agent-turn-result-error`, exposes `reason`, the known `session_id`/`turn_id` and `turn`, completed partial `messages`, `required_actions`, and the original transport `cause` when available. Failed or cancelled turns, unhandled required actions, interrupted observation, incomplete output, and ambiguous legacy message phases do not return a successful result. Raw event iteration continues to support manual tool handling; `finalResult()` instead reports actions that its helper cannot handle. Reconnection and structured parsing are not provided by this getter.

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
