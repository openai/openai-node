# Chat Completion Helpers

## Streaming Responses

```ts
openai.chat.completions.stream({ stream?: false, … }, options?): ChatCompletionStreamingRunner
```

`openai.chat.completions.stream()` returns a `ChatCompletionStreamingRunner`, which emits events, has an async
iterator, and exposes helper methods to accumulate chunks into a convenient shape and make it easy to reason
about the conversation.

Alternatively, you can use `openai.chat.completions.create({ stream: true, … })` which returns an async
iteratable of the chunks in the stream and uses less memory (most notably, it does not accumulate a final chat
completion object for you).

If you need to cancel a stream, you can `break` from a `for await` loop or call `stream.abort()`.

See an example of streaming helpers in action in [`examples/stream.ts`](examples/stream.ts).

## Automated Function Calls

```ts
openai.chat.completions.runFunctions({ stream: false, … }, options?): ChatCompletionRunner
openai.chat.completions.runFunctions({ stream: true, … }, options?): ChatCompletionStreamingRunner

openai.chat.completions.runTools({ stream: false, … }, options?): ChatCompletionRunner
openai.chat.completions.runTools({ stream: true, … }, options?): ChatCompletionStreamingRunner
```

`openai.chat.completions.runFunctions()` and `openai.chat.completions.runTools()` return a Runner
for automating function calls with chat completions.
The runner automatically calls the JavaScript functions you provide and sends their results back
to the API, looping as long as the model requests function calls.

If you pass a `parse` function, it will automatically parse the `arguments` for you and returns any parsing
errors to the model to attempt auto-recovery. Otherwise, the args will be passed to the function you provide
as a string.

```ts
client.chat.completions.runFunctions({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'How is the weather this week?' }],
  functions: [{
    function: getWeather as (args: { location: string, time: Date}) => any,
    parse: parseFunction as (args: strings) => { location: string, time: Date }.
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        time: { type: 'string', format: 'date-time' },
      },
    },
  }],
});
```

```ts
client.chat.completions.runTools({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: 'How is the weather this week?' }],
  tools: [{
    type: 'function',
    function: {
      function: getWeather as (args: { location: string, time: Date}) => any,
      parse: parseFunction as (args: strings) => { location: string, time: Date },
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          time: { type: 'string', format: 'date-time' },
        },
      },
    }
  }],
});
```


If you pass `function_call: {name: …}` instead of `auto`, it returns immediately after calling that
function (and only loops to auto-recover parsing errors).

By default, we run the loop up to 10 chat completions from the API. You can change this behavior by
adjusting `maxChatCompletions` in the request options object. Note that `max_tokens` is the limit per
chat completion request, not for the entire call run.

See an example of automated function calls in action in
[`examples/function-call-helpers.ts`](examples/function-call-helpers.ts).

## Runner API

### Events

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
sent as the parameter to either `.runFunctions()` or `.stream()`

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

### Methods

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

### Fields

#### `.messages`

A mutable array of all messages in the conversation.

#### `.controller`

The underlying `AbortController` for the runner.

## Examples

### Abort on a function call

If you have a function call flow which you intend to _end_ with a certain function call, then you can use the second
argument `runner` given to the function to either mutate `runner.messages` or call `runner.abort()`.

```ts
import OpenAI from 'openai';

const client = new OpenAI();

async function main() {
  const runner = client.chat.completions
    .runFunctions({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: "How's the weather this week in Los Angeles?" }],
      functions: [
        {
          function: function queryDatabase(props) { … },
          …
        },
        {
          function: function updateDatabase(props, runner) {
            runner.abort()
          },
          …
        },
      ],
    })
    .on('message', (message) => console.log(message));

  const finalFunctionCall = await runner.finalFunctionCall();
  console.log('Final function call:', finalFunctionCall);
}

main();
```


### Integrate with `zod`

[`zod`](https://www.npmjs.com/package/zod) is a schema validation library which can help with validating the
assistant's response to make sure it conforms to a schema. Paired with [`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema), the validation schema also acts as the `parameters` JSON Schema passed to the API.

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const client = new OpenAI();

async function main() {
  const runner = client.chat.completions
    .runFunctions({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: "How's the weather this week in Los Angeles?" }],
      functions: [
        {
          function: getWeather,
          parse: GetWeatherParameters.parse,
          parameters: zodToJsonSchema(GetWeatherParameters),
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

See a more fully-fledged example in [`examples/function-call-helpers-zod.ts`](examples/function-call-helpers-zod.ts).

### Integrate with Next.JS

See an example of a Next.JS integration here [`examples/stream-to-client-next.ts`](examples/stream-to-client-next.ts).

### Proxy Streaming to a Browser

See an example of using express to stream to a browser here [`examples/stream-to-client-express.ts`](examples/stream-to-client-express.ts).

