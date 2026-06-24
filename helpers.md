# Structured Outputs Parsing Helpers

The OpenAI API supports extracting JSON from the model with the `response_format` request param, for more details on the API, see [this guide](https://platform.openai.com/docs/guides/structured-outputs).

The SDK provides a `client.chat.completions.parse()` method which is a wrapper over the `client.chat.completions.create()` that
provides richer integrations with TS specific types & returns a `ParsedChatCompletion` object, which is an extension of the standard `ChatCompletion` type.

## Auto-parsing response content with Zod schemas

You can pass zod schemas wrapped with `zodResponseFormat()` to the `.parse()` method and the SDK will automatically convert the model
into a JSON schema, send it to the API and parse the response content back using the given zod schema.

```ts
import { zodResponseFormat } from 'openai/helpers/zod';
import OpenAI from 'openai/index';
import { z } from 'zod/v3';

const Step = z.object({
  explanation: z.string(),
  output: z.string(),
});

const MathResponse = z.object({
  steps: z.array(Step),
  final_answer: z.string(),
});

const client = new OpenAI();

const completion = await client.chat.completions.parse({
  model: 'gpt-4o-2024-08-06',
  messages: [
    { role: 'system', content: 'You are a helpful math tutor.' },
    { role: 'user', content: 'solve 8x + 31 = 2' },
  ],
  response_format: zodResponseFormat(MathResponse, 'math_response'),
});

console.dir(completion, { depth: 5 });

const message = completion.choices[0]?.message;
if (message?.parsed) {
  console.log(message.parsed.steps);
  console.log(`answer: ${message.parsed.final_answer}`);
}
```

### Supported Zod features

The Zod helpers convert your schema to JSON Schema and adapt it to the strict subset
supported by [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs#supported-schemas).
The root schema must be a `z.object()`. Common property schemas such as `z.string()`,
`z.number()`, `z.boolean()`, `z.array()`, `z.enum()`, `z.literal()`, `z.union()`, and
nullable fields are supported when they can be represented by that subset. A
`z.union()` can be nested inside an object, but a root `z.union()` or
`z.discriminatedUnion()` is not supported because it produces a root-level `anyOf`.

Some Zod behavior cannot be represented in the schema sent to the API:

- All object properties must be required and will be present in the model's answer.
  To emulate an optional value, make the field nullable instead of using plain
  `.optional()`; the model will return either a value or `null` for that field.
- Only constraints represented in the generated JSON Schema can guide the model.
  Custom refinements and transforms still run when the SDK parses the response, but
  some schemas that cannot be converted, including bare transforms in Zod v4, cause
  the helper to throw before a request is made.
- TypeScript comments are not available at runtime and are not sent to the API. Use
  `.describe()` for field descriptions or the helper's `description` option for a
  top-level response format or function description.
- Zod v4 copies `.meta()` values into the generated JSON Schema. Only attach metadata
  that is accepted by Structured Outputs and that you intend to send to the API.

## Auto-parsing function tool calls

The `.parse()` method will also automatically parse `function` tool calls if:

- You use the `zodFunction()` helper method
- You mark your tool schema with `"strict": True`

For example:

```ts
import { zodFunction } from 'openai/helpers/zod';
import OpenAI from 'openai/index';
import { z } from 'zod/v3';

const Table = z.enum(['orders', 'customers', 'products']);

const Column = z.enum([
  'id',
  'status',
  'expected_delivery_date',
  'delivered_at',
  'shipped_at',
  'ordered_at',
  'canceled_at',
]);

const Operator = z.enum(['=', '>', '<', '<=', '>=', '!=']);

const OrderBy = z.enum(['asc', 'desc']);

const DynamicValue = z.object({
  column_name: z.string(),
});

const Condition = z.object({
  column: z.string(),
  operator: Operator,
  value: z.union([z.string(), z.number(), DynamicValue]),
});

const Query = z.object({
  table_name: Table,
  columns: z.array(Column),
  conditions: z.array(Condition),
  order_by: OrderBy,
});

const client = new OpenAI();
const completion = await client.chat.completions.parse({
  model: 'gpt-4o-2024-08-06',
  messages: [
    {
      role: 'system',
      content:
        'You are a helpful assistant. The current date is August 6, 2024. You help users query for the data they are looking for by calling the query function.',
    },
    {
      role: 'user',
      content: 'look up all my orders in november of last year that were fulfilled but not delivered on time',
    },
  ],
  tools: [zodFunction({ name: 'query', parameters: Query })],
});
console.dir(completion, { depth: 10 });

const toolCall = completion.choices[0]?.message.tool_calls?.[0];
if (toolCall) {
  const args = toolCall.function.parsed_arguments as z.infer<typeof Query>;
  console.log(args);
  console.log(args.table_name);
}

main();
```

### Differences from `.create()`

The `chat.completions.parse()` method imposes some additional restrictions on it's usage that `chat.completions.create()` does not.

- If the completion completes with `finish_reason` set to `length` or `content_filter`, the `LengthFinishReasonError` / `ContentFilterFinishReasonError` errors will be raised.
- Only strict function tools can be passed, e.g. `{type: 'function', function: {..., strict: true}}`

# Streaming Helpers

OpenAI supports streaming responses when interacting with the [Chat](#chat-streaming) or [Assistant](#assistant-streaming-api) APIs.

## Assistant Streaming API

> **Deprecated:** The Assistants API is deprecated and will shut down on August 26, 2026. For new
> integrations, use the Responses API. See the [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration).

For existing Assistants integrations, the SDK provides convenience wrappers around the streaming API so you
can subscribe to the types of events you are interested in as well as receive accumulated responses.

#### An example of creating a run and subscribing to some events

```ts
const run = openai.beta.threads.runs
  .stream(thread.id, { assistant_id: assistant.id })
  .on('textCreated', (text) => process.stdout.write('\nassistant > '))
  .on('textDelta', (textDelta, snapshot) => process.stdout.write(textDelta.value))
  .on('toolCallCreated', (toolCall) => process.stdout.write(`\nassistant > ${toolCall.type}\n\n`))
  .on('toolCallDelta', (toolCallDelta, snapshot) => {
    if (toolCallDelta.type === 'code_interpreter') {
      if (toolCallDelta.code_interpreter.input) {
        process.stdout.write(toolCallDelta.code_interpreter.input);
      }
      if (toolCallDelta.code_interpreter.outputs) {
        process.stdout.write('\noutput >\n');
        toolCallDelta.code_interpreter.outputs.forEach((output) => {
          if (output.type === 'logs') {
            process.stdout.write(`\n${output.logs}\n`);
          }
        });
      }
    }
  });
```

### Starting a stream

There are three helper methods for creating streams:

```ts
openai.beta.threads.runs.stream();
```

This method can be used to start and stream the response to an existing run with an associated thread
that is already populated with messages.

```ts
openai.beta.threads.createAndRunStream();
```

This method can be used to add a message to a thread, start a run and then stream the response.

```ts
openai.beta.threads.runs.submitToolOutputsStream();
```

This method can be used to submit a tool output to a run waiting on the output and start a stream.

### Assistant Events

The assistant API provides events you can subscribe to for the following events.

```ts
.on('event', (event: AssistantStreamEvent) => ...)
```

This allows you to subscribe to raw Assistants lifecycle events sent by the OpenAI streaming API.
In many cases it will be more convenient to subscribe to a more specific set of events for your use case.

More information on the types of events can be found here: [Events](https://platform.openai.com/docs/api-reference/assistants-streaming/events)

Raw API event names, such as `thread.run.completed`, are exposed through the `event` listener. The
SDK-specific convenience listeners below use names such as `messageDone`, `runStepDone`, and `end`.

```ts
run.on('event', (event) => {
  if (event.event === 'thread.run.completed') {
    console.log('run completed', event.data);
  }
});
```

```ts
.on('runStepCreated', (runStep: RunStep) => ...)
.on('runStepDelta', (delta: RunStepDelta, snapshot: RunStep) => ...)
.on('runStepDone', (runStep: RunStep) => ...)
```

These events allow you to subscribe to the creation, delta and completion of a RunStep.

For more information on how Runs and RunSteps work see the documentation [Runs and RunSteps](https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps)

```ts
.on('messageCreated', (message: Message) => ...)
.on('messageDelta', (delta: MessageDelta, snapshot: Message) => ...)
.on('messageDone', (message: Message) => ...)
```

This allows you to subscribe to Message creation, delta and completion events. Messages can contain
different types of content that can be sent from a model (and events are available for specific content types).
For convenience, the delta event includes both the incremental update and an accumulated snapshot of the content.

More information on messages can be found
on in the documentation page [Message](https://platform.openai.com/docs/api-reference/messages/object).

```ts
.on('textCreated', (content: Text) => ...)
.on('textDelta', (delta: TextDelta, snapshot: Text) => ...)
.on('textDone', (content: Text, snapshot: Message) => ...)
```

These events allow you to subscribe to the creation, delta and completion of a Text content (a specific type of message).
For convenience, the delta event includes both the incremental update and an accumulated snapshot of the content.

```ts
.on('imageFileDone', (content: ImageFile, snapshot: Message) => ...)
```

Image files are not sent incrementally so an event is provided for when a image file is available.

```ts
.on('toolCallCreated', (toolCall: ToolCall) => ...)
.on('toolCallDelta', (delta: RunStepDelta, snapshot: ToolCall) => ...)
.on('toolCallDone', (toolCall: ToolCall) => ...)
```

These events allow you to subscribe to events for the creation, delta and completion of a ToolCall.

More information on tools can be found here [Tools](https://platform.openai.com/docs/assistants/tools)

```ts
.on('error', (error: OpenAIError) => ...)
.on('end', () => ...)
```

The `error` event is emitted when the stream encounters an API or SDK error. The `end` event is the last SDK
event emitted when the stream finishes, including after an error or abort. The raw `[DONE]` marker is consumed
by the SDK rather than emitted through the `event` listener.

### Assistant Methods

The assistant streaming object also provides a few methods for convenience:

```ts
.currentEvent(): AssistantStreamEvent | undefined

.currentRun(): Run | undefined

.currentMessageSnapshot(): Message

.currentRunStepSnapshot(): Runs.RunStep
```

These methods are provided to allow you to access additional context from within event handlers. In many cases
the handlers should include all the information you need for processing, but if additional context is required it
can be accessed.

Note: There is not always a relevant context in certain situations (these will be `undefined` in those cases).

```ts
await .finalMessages() : Promise<Message[]>

await .finalRunSteps(): Promise<RunStep[]>
```

These methods are provided for convenience to collect information at the end of a stream. Calling these events
will trigger consumption of the stream until completion and then return the relevant accumulated objects.

## Chat Streaming

### Streaming Responses

```ts
openai.chat.completions.stream({ stream?: false, … }, options?): ChatCompletionStreamingRunner
```

`openai.chat.completions.stream()` returns a `ChatCompletionStreamingRunner`, which emits events, has an async
iterator, and exposes helper methods to accumulate chunks into a convenient shape and make it easy to reason
about the conversation.

Alternatively, you can use `openai.chat.completions.create({ stream: true, … })` which returns an async
iterable of the chunks in the stream and uses less memory (most notably, it does not accumulate a final chat
completion object for you).

If you need to cancel a stream, you can `break` from a `for await` loop or call `stream.abort()`.

See an example of streaming helpers in action in [`examples/stream.ts`](examples/stream.ts).

### Automated function calls

We provide the `openai.chat.completions.runTools({…})`
convenience helper for using function tool calls with the `/chat/completions` endpoint
which automatically call the JavaScript functions you provide
and sends their results back to the `/chat/completions` endpoint,
looping as long as the model requests tool calls.

If you pass a `parse` function, it will automatically parse the `arguments` for you
and returns any parsing errors to the model to attempt auto-recovery.
Otherwise, the args will be passed to the function you provide as a string.

When a completion requests multiple tool calls, `runTools` executes them concurrently by default and
sends their results back in the same order as the tool calls. Set `parallel_tool_calls: false` to request
one tool call at a time and execute any returned group sequentially.

If you pass `tool_choice: {function: {name: …}}` instead of `auto`,
it returns immediately after calling that function (and only loops to auto-recover parsing errors).

```ts
import OpenAI from 'openai';

const client = new OpenAI();

async function main() {
  const runner = client.chat.completions
    .runTools({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'How is the weather this week?' }],
      tools: [
        {
          type: 'function',
          function: {
            function: getCurrentLocation,
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function',
          function: {
            function: getWeather,
            parse: JSON.parse, // or use a validation library like zod for typesafe parsing.
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        },
      ],
    })
    .on('message', (message) => console.log(message));

  const finalContent = await runner.finalContent();
  console.log();
  console.log('Final content:', finalContent);
}

async function getCurrentLocation() {
  return 'Boston'; // Simulate lookup
}

async function getWeather(args: { location: string }) {
  const { location } = args;
  // … do lookup …
  return { temperature, precipitation };
}

main();

// {role: "user",      content: "How's the weather this week?"}
// {role: "assistant", tool_calls: [{type: "function", function: {name: "getCurrentLocation", arguments: "{}"}, id: "123"}
// {role: "tool",      name: "getCurrentLocation", content: "Boston", tool_call_id: "123"}
// {role: "assistant", tool_calls: [{type: "function", function: {name: "getWeather", arguments: '{"location": "Boston"}'}, id: "1234"}]}
// {role: "tool",      name: "getWeather", content: '{"temperature": "50degF", "preciptation": "high"}', tool_call_id: "1234"}
// {role: "assistant", content: "It's looking cold and rainy - you might want to wear a jacket!"}
//
// Final content: "It's looking cold and rainy - you might want to wear a jacket!"
```

Like with `.stream()`, we provide a variety of [helpers and events](helpers.md#chat-events).

Read more about various examples such as with integrating with [zod](#integrate-with-zod),
[next.js](#integrate-with-nextjs), and [proxying a stream to the browser](#proxy-streaming-to-a-browser).

By default, we run the loop up to 10 chat completions from the API. You can change this behavior by
adjusting `maxChatCompletions` in the request options object. Note that `max_tokens` is the limit per
chat completion request, not for the entire call run.

See an example of automated function calls in action in
[`examples/tool-call-helpers.ts`](examples/tool-call-helpers.ts).

Note, `runFunctions` was also previously available, but has been deprecated in favor of `runTools`.

### Chat Events

#### `.on('connect', () => …)`

The first event that is fired when the connection with the OpenAI API is established.

#### `.on('chunk', (chunk: ChatCompletionChunk, snapshot: ChatCompletionSnapshot) => …)` (with `stream`)

The event fired when a chunk is received from the API. Not fired when it is not streaming. The snapshot
returns an accumulated `ChatCompletionSnapshot`, which has a similar shape to `ChatCompletion` with optional
fields and is built up from the chunks.

#### `.on('chatCompletion', (completion: ChatCompletion) => …)`

The event fired when a chat completion is returned or done being streamed by the API.

#### `.on('message', (message: ChatCompletionMessageParam) => …)`

The event fired when a new message is either sent or received from the API. Does not fire for the messages
sent as the parameter to either `.runTools()` or `.stream()`

#### `.on('content', (content: string) => …)` (without `stream`)

The event fired when a message from the `assistant` is received from the API.

#### `.on('content', (delta: string, snapshot: string) => …)` (with `stream`)

The event fired when a chunk from the `assistant` is received from the API. The `delta` argument contains the
content of the chunk, while the `snapshot` returns the accumulated content for the current message.

#### `.on('functionCall', (functionCall: ChatCompletionMessage.FunctionCall) => …)`

The event fired when a function call is made by the assistant.

#### `.on('functionCallResult', (content: string) => …)`

The event fired when the function runner responds to the function call with `role: "function"`. The `content` of the
response is given as the first argument to the callback.

#### `.on('content.delta', (props: ContentDeltaEvent) => ...)`

The event fired for every chunk containing new content. The `props` object contains:

- `delta`: The new content string received in this chunk
- `snapshot`: The accumulated content so far
- `parsed`: The partially parsed content (if applicable)

#### `.on('content.done', (props: ContentDoneEvent<ParsedT>) => ...)`

The event fired when the content generation is complete. The `props` object contains:

- `content`: The full generated content
- `parsed`: The fully parsed content (if applicable)

#### `.on('refusal.delta', (props: RefusalDeltaEvent) => ...)`

The event fired when a chunk contains part of a content refusal. The `props` object contains:

- `delta`: The new refusal content string received in this chunk
- `snapshot`: The accumulated refusal content string so far

#### `.on('refusal.done', (props: RefusalDoneEvent) => ...)`

The event fired when the refusal content is complete. The `props` object contains:

- `refusal`: The full refusal content

#### `.on('tool_calls.function.arguments.delta', (props: FunctionToolCallArgumentsDeltaEvent) => ...)`

The event fired when a chunk contains part of a function tool call's arguments. The `props` object contains:

- `name`: The name of the function being called
- `index`: The index of the tool call
- `arguments`: The accumulated raw JSON string of arguments
- `parsed_arguments`: The partially parsed arguments object
- `arguments_delta`: The new JSON string fragment received in this chunk

#### `.on('tool_calls.function.arguments.done', (props: FunctionToolCallArgumentsDoneEvent) => ...)`

The event fired when a function tool call's arguments are complete. The `props` object contains:

- `name`: The name of the function being called
- `index`: The index of the tool call
- `arguments`: The full raw JSON string of arguments
- `parsed_arguments`: The fully parsed arguments object

#### `.on('logprobs.content.delta', (props: LogProbsContentDeltaEvent) => ...)`

The event fired when a chunk contains new content log probabilities. The `props` object contains:

- `content`: A list of the new log probabilities received in this chunk
- `snapshot`: A list of the accumulated log probabilities so far

#### `.on('logprobs.content.done', (props: LogProbsContentDoneEvent) => ...)`

The event fired when all content log probabilities have been received. The `props` object contains:

- `content`: The full list of token log probabilities for the content

#### `.on('logprobs.refusal.delta', (props: LogProbsRefusalDeltaEvent) => ...)`

The event fired when a chunk contains new refusal log probabilities. The `props` object contains:

- `refusal`: A list of the new log probabilities received in this chunk
- `snapshot`: A list of the accumulated log probabilities so far

#### `.on('logprobs.refusal.done', (props: LogProbsRefusalDoneEvent) => ...)`

The event fired when all refusal log probabilities have been received. The `props` object contains:

- `refusal`: The full list of token log probabilities for the refusal

#### `.on('finalChatCompletion', (completion: ChatCompletion) => …)`

The event fired for the final chat completion. If the function call runner exceeds the number
`maxChatCompletions`, then the last chat completion is given.

#### `.on('finalContent', (contentSnapshot: string) => …)`

The event fired for the `content` of the last `role: "assistant"` message. Not fired if there is no `assistant`
message.

#### `.on('finalMessage', (message: ChatCompletionMessage) => …)`

The event fired for the last message.

#### `.on('finalFunctionCall', (functionCall: ChatCompletionMessage.FunctionCall) => …)`

The event fired for the last message with a defined `function_call`.

#### `.on('finalFunctionCallResult', (content: string) => …)`

The event fired for the last message with a `role: "function"`.

#### `.on('error', (error: OpenAIError) => …)`

The event fired when an error is encountered outside of a `parse` function or an abort.

#### `.on('abort', (error: APIUserAbortError) => …)`

The event fired when the stream receives a signal to abort.

#### `.on('totalUsage', (usage: CompletionUsage) => …)` (without `stream`, usage is not currently reported with `stream`)

The event fired at the end, returning the total usage of the call.

#### `.on('end', () => …)`

The last event fired in the stream.

### Chat Methods

#### `.abort()`

Aborts the runner and the streaming request, equivalent to `.controller.abort()`. Calling `.abort()` on a
`ChatCompletionStreamingRunner` will also abort any in-flight network requests.

#### `await .done()`

An empty promise which resolves when the stream is done.

#### `await .finalChatCompletion()`

A promise which resolves with the final chat completion that was received from the API. Throws if the request
ends before a complete chat completion is returned.

#### `await .allChatCompletions()`

A promise which resolves with The array of all chat completions that were received from the API.

#### `await .finalContent()`

A promise which resolves with the `content` of the last `role: "assistant"` message. Throws if no such message
can be found.

#### `await .finalMessage()`

A promise which resolves with the last message.

#### `await .finalFunctionCall()`

A promise which resolves with the last message with a defined `function_call`. Throws if no such message is
found.

#### `await .finalFunctionCallResult()`

A promise which resolves with the last message with a `role: "function"`. Throws if no such message is found.

#### `await .totalUsage()` (without `stream`, usage is not currently reported with `stream`)

A promise which resolves with the total usage.

### Chat Fields

#### `.messages`

A mutable array of all messages in the conversation.

#### `.controller`

The underlying `AbortController` for the runner.

### Chat Examples

#### Abort on a function call

If you have a function call flow which you intend to _end_ with a certain function call, capture that call from the
`functionToolCall` event and use the second argument `runner` given to the function to mutate `runner.messages` or call
`runner.abort()`.

Calling `abort()` signals the runner's `AbortController`. If the run observes that signal before it otherwise finishes,
`done()` and the `final*` helpers reject with `APIUserAbortError`. Other tool callbacks that are already running are not
cancelled, so capture the terminating call before awaiting the runner and only ignore the expected abort error.

```ts
import OpenAI from 'openai';

const client = new OpenAI();

async function main() {
  let terminatingCall: OpenAI.Chat.ChatCompletionMessageFunctionToolCall.Function | undefined;

  const runner = client.chat.completions
    .runTools({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: "How's the weather this week in Los Angeles?" }],
      tools: [
        {
          type: 'function',
          function: {
            function: function updateDatabase(_props, runner) {
              runner.abort();
            },
            …
          }
        },
      ],
    })
    .on('message', (message) => console.log(message))
    .on('functionToolCall', (functionCall) => {
      if (functionCall.name === 'updateDatabase') terminatingCall = functionCall;
    })
    .on('abort', (error) => console.log('Run aborted:', error.message));

  try {
    await runner.done();
  } catch (error) {
    if (!(error instanceof OpenAI.APIUserAbortError)) throw error;
  }
  console.log('Function call that ended the run:', terminatingCall);
}

main();
```

#### Inspect or extend the conversation after each completion

The `afterCompletion` callback runs after a completion's tool calls have finished and is awaited before the
next request starts. It can inspect the completion and append context to the runner's mutable `messages` array.
The callback also runs for the final completion, when no further request will be made.

```ts
const runner = client.chat.completions.runTools(
  {
    model: 'gpt-4o',
    messages,
    tools,
  },
  {
    afterCompletion: async (completion, runner) => {
      if (!completion.choices[0]?.message.tool_calls?.length) return;

      const webResearch = await optionallyPerformWebResearch(runner.messages.slice(-10));
      if (webResearch) {
        runner.messages.push({
          role: 'system',
          content: `Use this up-to-date research to guide your next steps:\n\n${webResearch}`,
        });
      }
    },
  },
);
```

#### Integrate with `zod`

[`zod`](https://www.npmjs.com/package/zod) is a schema validation library which can help with validating the
assistant's response to make sure it conforms to a schema. Paired with [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema), the validation schema also acts as the `parameters` JSON Schema passed to the API.

```ts
import OpenAI from 'openai';
import { z } from 'zod/v3';
import { zodToJsonSchema } from 'zod-to-json-schema';

const client = new OpenAI();

async function main() {
  const runner = client.chat.completions
    .runTools({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: "How's the weather this week in Los Angeles?" }],
      tools: [
        {
          type: 'function',
          function: {
            function: getWeather,
            parse: GetWeatherParameters.parse,
            parameters: zodToJsonSchema(GetWeatherParameters),
          },
        },
      ],
    })
    .on('message', (message) => console.log(message));

  const finalContent = await runner.finalContent();
  console.log('Final content:', finalContent);
}

const GetWeatherParameters = z.object({
  location: z.enum(['Boston', 'New York City', 'Los Angeles', 'San Francisco']),
});

async function getWeather(args: z.infer<typeof GetWeatherParameters>) {
  const { location } = args;
  // … do lookup …
  return { temperature, precipitation };
}

main();
```

See a more fully-fledged example in [`examples/tool-call-helpers-zod.ts`](examples/tool-call-helpers-zod.ts).

#### Integrate with Next.JS

See an example of a Next.JS integration here [`examples/stream-to-client-next.ts`](examples/stream-to-client-next.ts).

#### Proxy Streaming to a Browser

See an example of using express to stream to a browser here [`examples/stream-to-client-express.ts`](examples/stream-to-client-express.ts).

# Polling Helpers

When interacting with the API some actions such as starting a Run and adding files to vector stores are asynchronous and take time to complete.
The SDK includes helper functions which will poll the status until it reaches a terminal state and then return the resulting object.
If an API method results in an action which could benefit from polling there will be a corresponding version of the
method ending in `_AndPoll`.

All methods also allow you to set the polling frequency, how often the API is checked for an update, via a function argument (`pollIntervalMs`).

The polling methods are:

```ts
client.beta.threads.createAndRunPoll(...)
client.beta.threads.runs.createAndPoll((...)
client.beta.threads.runs.submitToolOutputsAndPoll((...)
client.beta.vectorStores.files.uploadAndPoll((...)
client.beta.vectorStores.files.createAndPoll((...)
client.beta.vectorStores.fileBatches.createAndPoll((...)
client.beta.vectorStores.fileBatches.uploadAndPoll((...)
```

# Bulk Upload Helpers

When creating and interacting with vector stores, you can use the polling helpers to monitor the status of operations.
For convenience, we also provide a bulk upload helper to allow you to simultaneously upload several files at once.

```ts
const fileList = [
  createReadStream('/home/data/example.pdf'),
  ...
];

const batch = await openai.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {files: fileList});
```
