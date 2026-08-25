import { vi } from 'vitest';
import OpenAI from 'openai';
import { standardTextFormat } from 'openai/helpers/standard-schema';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  isParseableResponseFormat,
  makeParseableTextFormat,
  parseResponseFormatContent,
} from 'openai/lib/parser';
import type { AutoParseableTextFormat } from 'openai/lib/parser';
import { z as zodV4 } from 'zod/v4';
import { z as zodV4Mini } from 'zod/v4-mini';

type UnsafeFormatMetadata = Record<PropertyKey, unknown>;
interface ParsedWeather {
  city: string;
  normalized?: boolean;
}

const trustedName = 'trusted_weather';
const trustedDescription = 'Return validated weather details';
const responseText = '{"city":"Paris"}';

const standardSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'synthetic-validator',
    validate: (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'city' in value && typeof value.city === 'string') {
        return { value: { city: value.city, normalized: true as const } };
      }

      return { issues: [{ message: 'Expected a weather object with a city' }] };
    },
    jsonSchema: {
      input: () => ({
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      }),
    },
  },
};

interface FormatFactory {
  name: string;
  expectedParsed: ParsedWeather;
  create: (metadata?: UnsafeFormatMetadata) => AutoParseableTextFormat<unknown>;
}

const formatFactories: FormatFactory[] = [
  {
    name: 'Zod v4',
    expectedParsed: { city: 'Paris' },
    create: (metadata) =>
      zodTextFormat(
        zodV4.object({ city: zodV4.string() }),
        trustedName,
        metadata as Parameters<typeof zodTextFormat>[2],
      ),
  },
  {
    name: 'Zod v4 mini',
    expectedParsed: { city: 'Paris' },
    create: (metadata) =>
      zodTextFormat(
        zodV4Mini.object({ city: zodV4Mini.string() }),
        trustedName,
        metadata as Parameters<typeof zodTextFormat>[2],
      ),
  },
  {
    name: 'Standard Schema',
    expectedParsed: { city: 'Paris', normalized: true },
    create: (metadata) =>
      standardTextFormat(standardSchema, trustedName, metadata as Parameters<typeof standardTextFormat>[2]),
  },
];

function expectTrustedFormat(format: AutoParseableTextFormat<unknown>) {
  expect(format).toMatchObject({
    type: 'json_schema',
    name: trustedName,
    strict: true,
    description: trustedDescription,
    schema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false,
    },
  });
  expect(Object.getOwnPropertyDescriptor(format, 'type')).toEqual({
    value: 'json_schema',
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function makeResponsePayload() {
  return {
    id: 'resp_synthetic',
    object: 'response',
    created_at: 0,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5.4-mini',
    output: [
      {
        id: 'msg_synthetic',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            annotations: [],
            logprobs: [],
            text: responseText,
          },
        ],
      },
    ],
    output_text: responseText,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: 'auto',
    tools: [],
    top_p: null,
  };
}

describe.each(formatFactories)('$name structured text-format integrity', ({ create, expectedParsed }) => {
  test.each([
    ['plain text', 'text'],
    ['unconstrained JSON', 'json_object'],
    ['null', null],
    ['undefined', undefined],
    ['numeric', 42],
    ['object', { discriminator: 'text' }],
  ])('does not let %s metadata replace the required schema discriminator', (_kind, override) => {
    const metadata = Object.freeze({
      type: override,
      name: 'attacker_controlled_name',
      strict: false,
      description: trustedDescription,
    });

    const format = create(metadata);

    expectTrustedFormat(format);
    expect(format.$parseRaw(responseText)).toEqual(expectedParsed);
    expect(metadata.type).toBe(override);
    expect(metadata.name).toBe('attacker_controlled_name');
    expect(metadata.strict).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test('evaluates an enumerable discriminator getter exactly once', () => {
    let getterCalls = 0;
    const metadata: UnsafeFormatMetadata = { description: trustedDescription };
    Object.defineProperty(metadata, 'type', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'text';
      },
    });
    Object.freeze(metadata);

    const format = create(metadata);

    expectTrustedFormat(format);
    expect(getterCalls).toBe(1);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test('ignores inherited and non-enumerable metadata discriminators', () => {
    const inherited = Object.assign(Object.create({ type: 'text' }), {
      description: trustedDescription,
    }) as UnsafeFormatMetadata;
    const hidden: UnsafeFormatMetadata = { description: trustedDescription };
    Object.defineProperty(hidden, 'type', { value: 'json_object', enumerable: false });

    expectTrustedFormat(create(inherited));
    expectTrustedFormat(create(hidden));
  });

  test('preserves enumerable symbols and prototype-safe metadata entries', () => {
    const metadataSymbol = Symbol('synthetic-format-metadata');
    const metadata = JSON.parse(
      '{"type":"text","description":"Return validated weather details","__proto__":{"polluted":"no"}}',
    ) as UnsafeFormatMetadata;
    metadata[metadataSymbol] = 'preserved';

    const format = create(metadata);
    const record = format as unknown as UnsafeFormatMetadata;

    expectTrustedFormat(format);
    expect(record[metadataSymbol]).toBe('preserved');
    expect(Object.getPrototypeOf(format)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(format, '__proto__')?.value).toEqual({ polluted: 'no' });
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test('keeps parsing metadata non-enumerable and replaces caller-supplied parser markers', () => {
    const hostileParser = vi.fn(() => ({ compromised: true }));
    const format = create({
      type: 'text',
      description: trustedDescription,
      $brand: 'attacker-controlled-brand',
      $parseRaw: hostileParser,
    });
    const brand = Object.getOwnPropertyDescriptor(format, '$brand');
    const parser = Object.getOwnPropertyDescriptor(format, '$parseRaw');
    const ordinary = create({ description: trustedDescription });

    expectTrustedFormat(format);
    expect(brand).toEqual({
      value: 'auto-parseable-response-format',
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(parser).toMatchObject({
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(Object.getOwnPropertyDescriptor(ordinary, '$brand')).toEqual({
      value: 'auto-parseable-response-format',
      enumerable: false,
      configurable: false,
      writable: false,
    });
    expect(Object.getOwnPropertyDescriptor(ordinary, '$parseRaw')).toMatchObject({
      enumerable: false,
      configurable: false,
      writable: false,
    });
    expect(format.$parseRaw(responseText)).toEqual(expectedParsed);
    expect(hostileParser).not.toHaveBeenCalled();
    expect(Object.keys(format)).not.toContain('$brand');
    expect(Object.keys(format)).not.toContain('$parseRaw');
    expect(JSON.stringify(format)).not.toContain('$brand');
    expect(JSON.stringify(format)).not.toContain('$parseRaw');
  });

  test.each([
    ['plain-text serializer', 'text', false],
    ['unconstrained JSON serializer', 'json_object', false],
    ['accessor-returned serializer', 'text', true],
  ] as const)(
    'never lets an own %s downgrade the actual Responses request',
    async (_kind, override, useAccessor) => {
      const serializer = vi.fn(() => ({
        type: override,
        name: 'attacker_controlled_name',
        strict: false,
        schema: { type: 'string', secret: 'synthetic-private-schema-fragment' },
      }));
      const getter = vi.fn(() => serializer);
      const metadataSymbol = Symbol('preserved-serializer-metadata');
      const metadata: UnsafeFormatMetadata = {
        description: trustedDescription,
        [metadataSymbol]: 'preserved',
      };

      if (useAccessor) {
        Object.defineProperty(metadata, 'toJSON', {
          configurable: true,
          enumerable: true,
          get: getter,
        });
      } else {
        metadata['toJSON'] = serializer;
      }
      Object.freeze(metadata);

      let requestBody: { text?: { format?: Record<string, unknown> } } | undefined;
      const fetch = vi.fn(async (_request: unknown, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string) as typeof requestBody;
        return Response.json(makeResponsePayload(), { status: 200 });
      });
      const client = new OpenAI({
        apiKey: 'sk-synthetic-structured-format',
        maxRetries: 0,
        fetch,
      });
      const format = create(metadata);
      const response = await client.responses.parse({
        model: 'gpt-5.4-mini',
        input: 'Describe the weather in Paris',
        text: { format },
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(requestBody?.text?.format).toMatchObject({
        type: 'json_schema',
        name: trustedName,
        strict: true,
        description: trustedDescription,
        schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      });
      expect(JSON.stringify(requestBody?.text?.format)).not.toContain('synthetic-private-schema-fragment');
      expect(serializer).not.toHaveBeenCalled();
      expect(getter).toHaveBeenCalledTimes(useAccessor ? 1 : 0);
      expect(Object.getOwnPropertyDescriptor(format, 'toJSON')).toBeUndefined();
      expect((format as unknown as UnsafeFormatMetadata)[metadataSymbol]).toBe('preserved');
      expect(Object.isFrozen(metadata)).toBe(true);
      expect(response.output_parsed).toEqual(expectedParsed);
    },
  );

  test('ignores inherited and non-enumerable metadata serialization hooks', () => {
    const inheritedSerializer = vi.fn(() => ({ type: 'text' }));
    const hiddenSerializer = vi.fn(() => ({ type: 'json_object' }));
    const inherited = Object.assign(Object.create({ toJSON: inheritedSerializer }), {
      description: trustedDescription,
    }) as UnsafeFormatMetadata;
    const hidden: UnsafeFormatMetadata = { description: trustedDescription };
    Object.defineProperty(hidden, 'toJSON', { enumerable: false, value: hiddenSerializer });

    for (const metadata of [inherited, hidden]) {
      const format = create(metadata);
      const wire = JSON.stringify(format);
      const serialized = JSON.parse(wire) as Record<string, unknown>;

      expectTrustedFormat(format);
      expect(serialized).toMatchObject({ type: 'json_schema', name: trustedName, strict: true });
      expect(Object.getOwnPropertyDescriptor(format, 'toJSON')).toBeUndefined();
    }

    expect(inheritedSerializer).not.toHaveBeenCalled();
    expect(hiddenSerializer).not.toHaveBeenCalled();
  });

  test.each(['text', 'json_object'])(
    'sends a strict schema and validates the public Responses parse result despite %s metadata',
    async (override) => {
      let requestBody: { text?: { format?: Record<string, unknown> } } | undefined;
      const fetch = vi.fn(async (_request: unknown, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string) as typeof requestBody;
        return Response.json(makeResponsePayload(), { status: 200 });
      });
      const client = new OpenAI({
        apiKey: 'sk-synthetic-structured-format',
        maxRetries: 0,
        fetch,
      });
      const format = create({
        type: override,
        strict: false,
        name: 'attacker_controlled_name',
        description: trustedDescription,
      });

      const response = await client.responses.parse({
        model: 'gpt-5.4-mini',
        input: 'Describe the weather in Paris',
        text: { format },
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(requestBody?.text?.format).toMatchObject({
        type: 'json_schema',
        name: trustedName,
        strict: true,
        description: trustedDescription,
        schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      });
      expect(requestBody?.text?.format).not.toHaveProperty('$brand');
      expect(requestBody?.text?.format).not.toHaveProperty('$parseRaw');
      expect(response.output_parsed).toEqual(expectedParsed);
    },
  );

  test('preserves valid ordinary metadata and validation failures', () => {
    const format = create({ description: trustedDescription });

    expectTrustedFormat(format);
    expect(format.$parseRaw(responseText)).toEqual(expectedParsed);
    expect(() => format.$parseRaw('{"city":42}')).toThrow();

    const mutableFormat = format as unknown as UnsafeFormatMetadata;
    mutableFormat['type'] = 'text';
    mutableFormat['strict'] = false;
    expect(mutableFormat).toMatchObject({ type: 'text', strict: false });
  });

  test('preserves exceptions from hostile metadata getters', () => {
    const failure = new Error('synthetic metadata getter failure');
    const metadata: UnsafeFormatMetadata = { description: trustedDescription };
    Object.defineProperty(metadata, 'type', {
      enumerable: true,
      get: () => {
        throw failure;
      },
    });

    expect(() => create(metadata)).toThrow(failure);
  });
});

describe('shared structured text-format factory', () => {
  test('normalizes a direct malformed factory input without mutating its frozen configuration', () => {
    const parser = vi.fn((content: string) => JSON.parse(content) as ParsedWeather);
    const original = Object.freeze({
      type: 'text' as unknown as 'json_schema',
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
        additionalProperties: false,
      },
    });

    const format = makeParseableTextFormat(original, parser);

    expectTrustedFormat(format);
    expect(format.$parseRaw(responseText)).toEqual({ city: 'Paris' });
    expect(parser).toHaveBeenCalledWith(responseText);
    expect(original.type).toBe('text');
    expect(Object.isFrozen(original)).toBe(true);
  });

  test('removes an own serializer from direct frozen factory configurations', () => {
    const serializer = vi.fn(() => ({
      type: 'text',
      strict: false,
      schema: { type: 'string' },
    }));
    const parser = vi.fn((content: string) => JSON.parse(content) as ParsedWeather);
    const original = Object.freeze({
      type: 'json_schema' as const,
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
        additionalProperties: false,
      },
      toJSON: serializer,
    });

    const format = makeParseableTextFormat(original, parser);
    const wire = JSON.stringify({ text: { format } });
    const serialized = JSON.parse(wire) as {
      text: { format: Record<string, unknown> };
    };

    expectTrustedFormat(format);
    expect(serialized.text.format).toMatchObject({
      type: 'json_schema',
      name: trustedName,
      strict: true,
      schema: { type: 'object' },
    });
    expect(serializer).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(format, 'toJSON')).toBeUndefined();
    expect(original.toJSON).toBe(serializer);
    expect(Object.isFrozen(original)).toBe(true);
    expect(format.$parseRaw(responseText)).toEqual({ city: 'Paris' });
    expect(parser).toHaveBeenCalledWith(responseText);
  });

  test('preserves intentional Standard Schema overrides while enforcing the text-format discriminator', () => {
    const customSchema = {
      type: 'object',
      properties: { city: { type: 'string', minLength: 2 } },
      required: ['city'],
    };
    const format = standardTextFormat(standardSchema, trustedName, {
      schema: customSchema,
      description: trustedDescription,
      type: 'text',
    } as Parameters<typeof standardTextFormat>[2]);

    expect(format.type).toBe('json_schema');
    expect(format.name).toBe(trustedName);
    expect(format.strict).toBe(true);
    expect(format.schema).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string', minLength: 2 } },
      required: ['city'],
      additionalProperties: false,
    });
  });

  test('leaves raw, unbranded text formats and custom json-schema parsers unchanged', () => {
    const customParser = vi.fn(() => ({ city: 'Rome' }));

    expect(isParseableResponseFormat({ type: 'text' })).toBe(false);
    expect(isParseableResponseFormat({ type: 'json_object' })).toBe(false);
    expect(parseResponseFormatContent({ type: 'text', $parseRaw: customParser }, responseText)).toBeNull();
    expect(customParser).not.toHaveBeenCalled();

    expect(
      parseResponseFormatContent(
        { type: 'json_schema', name: trustedName, schema: {}, $parseRaw: customParser },
        responseText,
      ),
    ).toEqual({ city: 'Rome' });
    expect(customParser).toHaveBeenCalledWith(responseText);
  });
});
