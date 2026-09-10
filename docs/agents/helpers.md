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
