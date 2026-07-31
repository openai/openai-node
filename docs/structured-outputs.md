# Structured Outputs

Structured Outputs lets a model return JSON that follows a schema. The Responses API is the recommended
starting point: call `client.responses.parse()` with a parseable `text.format`, then read the validated result
from `response.output_parsed`.

## Parse a response with Zod

Use `zodTextFormat()` to convert a Zod schema into the strict JSON Schema sent to the API and to validate the
model's response:

```ts
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod/v4';

const MathResponse = z.object({
  steps: z.array(
    z.object({
      explanation: z.string(),
      output: z.string(),
    }),
  ),
  final_answer: z.string(),
});

const client = new OpenAI();
const response = await client.responses.parse({
  model: 'gpt-5.5',
  input: 'Solve 8x + 31 = 2.',
  text: {
    format: zodTextFormat(MathResponse, 'math_response'),
  },
});

if (response.output_parsed) {
  console.log(response.output_parsed.final_answer);
}
```

`response.output_parsed` contains the first successfully parsed text output, or `null` when there is no parsed
output. For example, incomplete responses are left unparsed so their status and `incomplete_details` remain
available.

The Zod helpers support schemas imported from `zod/v3`, `zod/v4`, and `zod/v4-mini`. Use the import that
matches the Zod version in your application.

See the complete [Responses Structured Outputs example](../examples/responses/structured-outputs.ts).

## Parse function arguments with Zod

Use `zodResponsesFunction()` for Responses API function tools. Passing the tool to `responses.parse()` adds
validated `parsed_arguments` to each matching `function_call` output item:

```ts
import OpenAI from 'openai';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { z } from 'zod/v4';

const GetWeather = z.object({
  city: z.string(),
  unit: z.enum(['c', 'f']),
});

const client = new OpenAI();
const response = await client.responses.parse({
  model: 'gpt-5.5',
  input: 'What is the weather in Paris in Celsius?',
  tools: [
    zodResponsesFunction({
      name: 'get_weather',
      description: 'Look up the current weather for a city.',
      parameters: GetWeather,
    }),
  ],
});

for (const item of response.output) {
  if (item.type === 'function_call') {
    console.log(item.name, item.parsed_arguments);
  }
}
```

The helper generates `strict: true` and validates the arguments. It does not execute the function or send the
result back to the model. See the [tools guide](tools.md) for the complete Responses API tool loop and the
[Structured Outputs tools example](../examples/responses/structured-outputs-tools.ts).

## Standard Schema validators

Use `standardTextFormat()` and `standardResponsesFunction()` when your validator implements the Standard Schema
interface. The helpers use `~standard.jsonSchema.input({ target: 'draft-07' })` for the model-facing schema
and `~standard.validate()` to parse model output:

```ts
import OpenAI from 'openai';
import { standardResponsesFunction, standardTextFormat } from 'openai/helpers/standard-schema';
import { z } from 'zod/v4';

const Weather = z.object({
  city: z.string(),
  unit: z.enum(['c', 'f']),
});

const client = new OpenAI();
const response = await client.responses.parse({
  model: 'gpt-5.5',
  input: 'Return the weather in Paris in Celsius.',
  text: {
    format: standardTextFormat(Weather, 'weather'),
  },
  tools: [
    standardResponsesFunction({
      name: 'get_weather',
      parameters: Weather,
    }),
  ],
});

console.log(response.output_parsed);
```

Validation must be synchronous. Standard Schema validators whose `validate()` method returns a promise are not
supported by the SDK's parsing helpers.

### Provide a JSON Schema override

A validator that implements `~standard.validate()` but does not provide `~standard.jsonSchema.input()` needs
an explicit JSON Schema. Pass it as `schema` to the text-format helper or the function-tool helper:

```ts
import { standardResponsesFunction, standardTextFormat } from 'openai/helpers/standard-schema';

const weatherValidator = {
  '~standard': {
    version: 1 as const,
    vendor: 'example',
    validate(value: unknown) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'city' in value &&
        typeof value.city === 'string' &&
        'unit' in value &&
        (value.unit === 'c' || value.unit === 'f')
      ) {
        return { value: { city: value.city, unit: value.unit } };
      }

      return { issues: [{ message: 'Expected a city and a temperature unit.' }] };
    },
  },
};

const weatherSchema = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    unit: { type: 'string', enum: ['c', 'f'] },
  },
  required: ['city', 'unit'],
  additionalProperties: false,
};

const textFormat = standardTextFormat(weatherValidator, 'weather', {
  schema: weatherSchema,
});

const weatherTool = standardResponsesFunction({
  name: 'get_weather',
  parameters: weatherValidator,
  schema: weatherSchema,
});
```

Both helpers normalize compatible JSON Schemas for strict Structured Outputs. They reject unsupported schema
features and `oneOf` branches whose mutual exclusivity cannot be established. Validators that expose Standard
Schema type metadata retain their inferred output types; validators without that metadata parse as `unknown`.

## Schema requirements

Structured Outputs supports a subset of JSON Schema. Keep these constraints in mind when defining Zod or
Standard Schema validators:

- The root schema must describe an object. Root-level unions are not supported.
- Object properties must be required. Represent a value that may be absent as a required nullable field, for
  example `z.string().nullable()`, instead of a plain `z.string().optional()`.
- Nested unions, enums, arrays, literals, nullable values, and discriminated unions work when they can be
  represented in the supported strict JSON Schema subset.
- Model-visible descriptions must come from the schema, for example `z.string().describe('...')`. TypeScript
  comments are not available at runtime.
- Refinements and transforms still run during local validation, but unsupported conversions can fail before
  the request is sent.

For details, see the [Structured Outputs API guide](https://platform.openai.com/docs/guides/structured-outputs)
and the existing [helper compatibility notes](helpers.md#supported-zod-features).

## Chat Completions compatibility

Existing Chat Completions integrations can use `zodResponseFormat()` or `standardResponseFormat()` with
`client.chat.completions.parse()`. Parsed content is available as `message.parsed`, not
`response.output_parsed`:

```ts
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod/v4';

const Answer = z.object({ value: z.string() });
const client = new OpenAI();

const completion = await client.chat.completions.parse({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: 'Answer in one word.' }],
  response_format: zodResponseFormat(Answer, 'answer'),
});

console.log(completion.choices[0]?.message.parsed?.value);
```

For Chat Completions function arguments, use `zodFunction()` or `standardFunction()`. The existing
[helpers guide](helpers.md) covers Chat Completions parsing, streaming, and `runTools()` in more detail.
