# Function Tools

The Responses API lets a model request functions that your application executes. Your application owns the
execution loop: inspect `function_call` output items, run the matching function, and send a
`function_call_output` item back to the model.

## Run a Responses API function loop

Describe each function using a strict JSON Schema. Keep `additionalProperties: false`, list every property in
`required`, and include `strict: true`:

```ts
import OpenAI from 'openai';

const client = new OpenAI();
const model = 'gpt-5.5';
const tools = [
  {
    type: 'function' as const,
    name: 'get_weather',
    description: 'Return the current weather for a city.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
];

let response = await client.responses.create({
  model,
  input: 'What is the weather in Paris?',
  tools,
});

while (true) {
  const calls = response.output.filter((item) => item.type === 'function_call');

  if (response.status !== 'completed') {
    const details = response.error ?? response.incomplete_details;
    throw new Error(
      `Response status ${response.status ?? 'unknown'}: ${
        details ? JSON.stringify(details) : 'No additional details.'
      }`,
    );
  }

  if (calls.length === 0) {
    console.log(response.output_text);
    break;
  }

  const outputs = await Promise.all(
    calls.map(async (call) => {
      if (call.name !== 'get_weather') {
        throw new Error(`Unexpected function: ${call.name}`);
      }

      const args: unknown = JSON.parse(call.arguments);
      if (typeof args !== 'object' || args === null || !('city' in args) || typeof args.city !== 'string') {
        throw new Error('Invalid weather arguments');
      }

      const result = { city: args.city, temperature_c: 18 };

      return {
        type: 'function_call_output' as const,
        call_id: call.call_id,
        output: JSON.stringify(result),
      };
    }),
  );

  response = await client.responses.create({
    model,
    previous_response_id: response.id,
    input: outputs,
    tools,
  });
}
```

Match outputs using `call.call_id`, not the item's optional `id`. JSON-encode structured function results
before placing them in `output`. A response can contain multiple function calls, so inspect every output item
and return a result for each call.

`previous_response_id` continues the existing conversation. If you manage conversation history yourself,
preserve all replayable output items in their original order with `toResponseInputItems()`; see the
[manual conversation state example](../examples/responses/manual-conversation-state.ts).

## Parse typed arguments with Zod

`zodResponsesFunction()` converts a Zod schema into a strict Responses API tool and validates function-call
arguments when used with `client.responses.parse()`:

```ts
import OpenAI from 'openai';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { z } from 'zod/v4';

const WeatherArguments = z.object({
  city: z.string(),
  unit: z.enum(['c', 'f']),
});

const client = new OpenAI();
const response = await client.responses.parse({
  model: 'gpt-5.5',
  input: 'What is the temperature in Paris in Celsius?',
  tools: [
    zodResponsesFunction({
      name: 'get_weather',
      description: 'Return the current weather for a city.',
      parameters: WeatherArguments,
    }),
  ],
});

for (const item of response.output) {
  if (item.type === 'function_call') {
    const args: z.infer<typeof WeatherArguments> = item.parsed_arguments;
    console.log(args.city, args.unit);
  }
}
```

`standardResponsesFunction()` from `openai/helpers/standard-schema` provides the same parsing integration for
Standard Schema validators. Validators must be synchronous and must either implement
`~standard.jsonSchema.input()` or receive an explicit `schema` option. See the
[Structured Outputs guide](structured-outputs.md#standard-schema-validators).

These helpers parse and validate arguments, but they do not execute functions automatically. Even when a helper
receives a `function` callback, the Responses API still requires your application to run the tool and submit a
`function_call_output` item.

See the complete [typed function tool example](../examples/responses/structured-outputs-tools.ts).

## Stream function calls

Use `client.responses.stream()` to consume tool-call events as the model generates them. Function arguments
arrive incrementally as `response.function_call_arguments.delta` events; use the completed output item or the
final parsed response when you are ready to validate and execute the call:

```ts
import OpenAI from 'openai';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { z } from 'zod/v4';

const WeatherArguments = z.object({ city: z.string() });
const client = new OpenAI();

const stream = client.responses.stream({
  model: 'gpt-5.5',
  input: 'What is the weather in Paris?',
  tools: [zodResponsesFunction({ name: 'get_weather', parameters: WeatherArguments })],
});

stream.on('response.function_call_arguments.delta', (event) => {
  process.stdout.write(event.delta);
});

const response = await stream.finalResponse();

for (const item of response.output) {
  if (item.type === 'function_call') {
    console.log(item.parsed_arguments.city);
  }
}
```

The stream can also be consumed with `for await (const event of stream)`. Its final response applies the same
argument parsing used by `responses.parse()`. See the [streaming tools example](../examples/responses/streaming-tools.ts)
and the [Responses WebSocket tool loop](../examples/responses/websocket.ts).

## Chat Completions `runTools()`

For existing Chat Completions integrations, `client.chat.completions.runTools()` provides an automated
function-execution loop. Use `zodFunction()` for Zod schemas or `standardFunction()` for Standard Schema
validators, and provide a `function` callback for every tool:

```ts
import OpenAI from 'openai';
import { zodFunction } from 'openai/helpers/zod';
import { z } from 'zod/v4';

const GetWeather = z.object({ city: z.string() });
const client = new OpenAI();

const runner = client.chat.completions.runTools({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  tools: [
    zodFunction({
      name: 'get_weather',
      parameters: GetWeather,
      function: async ({ city }) => ({ city, temperature_c: 18 }),
    }),
  ],
});

console.log(await runner.finalContent());
```

Unlike the Responses API helpers, `runTools()` invokes the supplied functions, sends their results back to Chat
Completions, and continues until the model produces a final answer. Tool calls returned together are executed
concurrently by default; set `parallel_tool_calls: false` to request sequential execution.

See the [automated function calls documentation](helpers.md#automated-function-calls) and the complete
[Zod tool runner example](../examples/tool-call-helpers-zod.ts).

## Realtime function tools

Use `zodRealtimeFunction()` to describe a Zod-backed function to the Realtime API:

```ts
import { zodRealtimeFunction } from 'openai/helpers/zod';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import { z } from 'zod/v4';

const WeatherArguments = z.object({
  city: z.string(),
  unit: z.enum(['c', 'f']).optional(),
});

const tool = zodRealtimeFunction({
  name: 'get_weather',
  description: 'Return the current weather for a city.',
  parameters: WeatherArguments,
});

const rt = new OpenAIRealtimeWebSocket({ model: 'gpt-realtime' });

rt.socket.addEventListener('open', () => {
  rt.send({
    type: 'session.update',
    session: {
      type: 'realtime',
      tools: [tool],
    },
  });
});
```

Realtime function definitions do not accept `strict`, so `zodRealtimeFunction()` intentionally omits it and
preserves optional parameters. It only creates the tool definition: parse completed function-call arguments
yourself with `WeatherArguments.parse(JSON.parse(argumentsJSON))`, execute the function, and send the result
back through the Realtime event flow. See the [Realtime API guide](realtime.md).
