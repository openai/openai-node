import { vi } from 'vitest';
import OpenAI from 'openai';
import { standardResponseFormat } from 'openai/helpers/standard-schema';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  isParseableResponseFormat,
  makeParseableResponseFormat,
  parseResponseFormatContent,
} from 'openai/lib/parser';
import type { AutoParseableResponseFormat } from 'openai/lib/parser';
import { z as zodV3 } from 'zod/v3';
import { z as zodV4 } from 'zod/v4';
import { z as zodV4Mini } from 'zod/v4-mini';

type UnsafeMetadata = Record<PropertyKey, unknown>;

interface ParsedWeather {
  city: string;
  normalized?: boolean;
}

const trustedName = 'trusted_weather';
const trustedDescription = 'Return validated weather details';
const responseText = '{"city":"Paris"}';
const trustedSchema = {
  type: 'object',
  properties: { city: { type: 'string' } },
  required: ['city'],
  additionalProperties: false,
};

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
  create: (metadata?: UnsafeMetadata) => AutoParseableResponseFormat<unknown>;
}

const formatFactories: FormatFactory[] = [
  {
    name: 'Zod v3',
    expectedParsed: { city: 'Paris' },
    create: (metadata) => zodResponseFormat(zodV3.object({ city: zodV3.string() }), trustedName, metadata),
  },
  {
    name: 'Zod v4',
    expectedParsed: { city: 'Paris' },
    create: (metadata) => zodResponseFormat(zodV4.object({ city: zodV4.string() }), trustedName, metadata),
  },
  {
    name: 'Zod v4 mini',
    expectedParsed: { city: 'Paris' },
    create: (metadata) =>
      zodResponseFormat(zodV4Mini.object({ city: zodV4Mini.string() }), trustedName, metadata),
  },
  {
    name: 'Standard Schema',
    expectedParsed: { city: 'Paris', normalized: true },
    create: (metadata) => standardResponseFormat(standardSchema, trustedName, metadata),
  },
];

function makeCompletionPayload() {
  return {
    id: 'chatcmpl_synthetic',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content: responseText,
          refusal: null,
        },
      },
    ],
  };
}

function parseSerializedJSON<T>(value: unknown): T {
  const serialized = JSON.stringify(value);
  // SAFETY: Callers pass formats built in this suite and immediately assert their serialized fields; T describes that expected test wire representation.
  return JSON.parse(serialized) as T;
}

function expectTrustedFormat(format: AutoParseableResponseFormat<unknown>) {
  expect(format).toMatchObject({
    type: 'json_schema',
    json_schema: {
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: trustedSchema,
    },
  });
  expect(Object.getOwnPropertyDescriptor(format, 'type')).toEqual({
    value: 'json_schema',
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

describe.each(formatFactories)(
  '$name chat structured response-format integrity',
  ({ create, expectedParsed }) => {
    test.each([
      ['unconstrained-object serializer', 'object', false],
      ['incorrect-type serializer', 'string', false],
      ['accessor-returned serializer', 'string', true],
    ] as const)(
      'prevents an own nested %s from replacing the actual Chat Completions request schema',
      async (_kind, replacementType, useAccessor) => {
        const serializer = vi.fn(() => ({
          name: 'attacker_controlled_name',
          strict: false,
          schema: { type: replacementType, secret: 'synthetic-private-schema-fragment' },
        }));
        const getter = vi.fn(() => serializer);
        const metadataSymbol = Symbol('preserved-chat-format-metadata');
        // oxlint-disable-next-line anti-slop/no-known-value-widening -- The fixture adds a callable toJSON field after selecting between a data property and an accessor.
        const metadata: UnsafeMetadata = {
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

        let body: { response_format?: { type: string; json_schema: Record<string, unknown> } } | undefined;
        const fetch = vi.fn(async (_request: string | URL | Request, init?: RequestInit) => {
          // SAFETY: This fetch mock intercepts the SDK JSON request generated by the local parse call; body is a serialized string at this boundary.
          body = JSON.parse(init?.body as string);
          return Response.json(makeCompletionPayload(), { status: 200 });
        });
        const client = new OpenAI({
          apiKey: 'sk-synthetic-chat-format',
          maxRetries: 0,
          fetch,
        });
        const format = create(metadata);
        const completion = await client.chat.completions.parse({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Describe the weather in Paris' }],
          response_format: format,
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(body?.response_format).toMatchObject({
          type: 'json_schema',
          json_schema: {
            name: trustedName,
            strict: true,
            description: trustedDescription,
            schema: trustedSchema,
          },
        });
        expect(JSON.stringify(body?.response_format)).not.toContain('synthetic-private-schema-fragment');
        expect(serializer).not.toHaveBeenCalled();
        expect(getter).toHaveBeenCalledTimes(useAccessor ? 1 : 0);
        expect(Object.getOwnPropertyDescriptor(format.json_schema, 'toJSON')).toBeUndefined();
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Inspect synthetic symbol metadata preserved outside the declared JSON Schema fields.
        expect((format.json_schema as unknown as UnsafeMetadata)[metadataSymbol]).toBe('preserved');
        expect(Object.isFrozen(metadata)).toBe(true);
        expect(completion.choices[0]?.message.parsed).toEqual(expectedParsed);
        expectTrustedFormat(format);
      },
    );

    test('ignores inherited and non-enumerable metadata serializers', () => {
      const inheritedSerializer = vi.fn(() => ({ strict: false }));
      const hiddenSerializer = vi.fn(() => ({ strict: false }));
      // SAFETY: Object.assign installs the known metadata fields on an object with an inherited serializer, which this regression must preserve.
      const inherited = Object.assign(Object.create({ toJSON: inheritedSerializer }), {
        description: trustedDescription,
      }) as UnsafeMetadata;
      const hidden = { description: trustedDescription };
      Object.defineProperty(hidden, 'toJSON', { enumerable: false, value: hiddenSerializer });

      for (const metadata of [inherited, hidden]) {
        const format = create(metadata);
        const serialized = parseSerializedJSON(format);

        expectTrustedFormat(format);
        expect(serialized).toMatchObject({
          type: 'json_schema',
          json_schema: { name: trustedName, strict: true },
        });
        expect(Object.getOwnPropertyDescriptor(format.json_schema, 'toJSON')).toBeUndefined();
      }

      expect(inheritedSerializer).not.toHaveBeenCalled();
      expect(hiddenSerializer).not.toHaveBeenCalled();
    });

    test('preserves ordinary metadata, local validation, and public mutability', () => {
      const format = create({
        name: 'attacker_controlled_name',
        strict: false,
        description: trustedDescription,
      });

      expectTrustedFormat(format);
      expect(format.$parseRaw(responseText)).toEqual(expectedParsed);
      expect(() => format.$parseRaw('{"city":42}')).toThrow();
      expect(isParseableResponseFormat(format)).toBe(true);

      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Deliberately mutate the published discriminator to verify the parser uses its captured contract.
      const mutable = format as unknown as UnsafeMetadata;
      mutable['type'] = 'text';
      format.json_schema.strict = false;
      expect(mutable['type']).toBe('text');
      expect(format.json_schema.strict).toBe(false);
    });

    test('preserves canonical non-enumerable parser descriptors', () => {
      const format = create({ description: trustedDescription });

      expect(Object.getOwnPropertyDescriptor(format, '$brand')).toEqual({
        value: 'auto-parseable-response-format',
        enumerable: false,
        configurable: false,
        writable: false,
      });
      expect(Object.getOwnPropertyDescriptor(format, '$parseRaw')).toMatchObject({
        enumerable: false,
        configurable: false,
        writable: false,
      });
      expect(Object.keys(format)).not.toContain('$brand');
      expect(Object.keys(format)).not.toContain('$parseRaw');
      expect(parseResponseFormatContent(format, responseText)).toEqual(expectedParsed);
    });
  },
);

describe('shared chat structured response-format factory', () => {
  test('normalizes frozen direct input and removes both root and nested serialization hooks', () => {
    const rootSerializer = vi.fn(() => ({ type: 'text' }));
    const nestedSerializer = vi.fn(() => ({
      name: 'attacker_controlled_name',
      strict: false,
      schema: { type: 'string' },
    }));
    const nestedSymbol = Symbol('direct-nested-metadata');
    const rootSymbol = Symbol('direct-root-metadata');
    const originalNested = Object.freeze({
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: trustedSchema,
      toJSON: nestedSerializer,
      [nestedSymbol]: 'nested-preserved',
    });
    const original = Object.freeze({
      // SAFETY: The deliberately wrong discriminator tests that the factory restores trusted format fields before serialization.
      type: 'text' as 'json_schema',
      json_schema: originalNested,
      toJSON: rootSerializer,
      [rootSymbol]: 'root-preserved',
    });
    // SAFETY: The parser receives responseText from this suite, whose JSON object has the ParsedWeather city field.
    const parser = vi.fn((content: string) => JSON.parse(content) as ParsedWeather);

    const format = makeParseableResponseFormat(original, parser);
    const wire = parseSerializedJSON<{
      response_format: { type: string; json_schema: Record<string, unknown> };
    }>({ response_format: format });

    expectTrustedFormat(format);
    expect(wire.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: trustedName,
        strict: true,
        description: trustedDescription,
        schema: trustedSchema,
      },
    });
    expect(rootSerializer).not.toHaveBeenCalled();
    expect(nestedSerializer).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(format, 'toJSON')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(format.json_schema, 'toJSON')).toBeUndefined();
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Inspect synthetic symbol metadata preserved outside the declared JSON Schema fields.
    expect((format as unknown as UnsafeMetadata)[rootSymbol]).toBe('root-preserved');
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Inspect synthetic symbol metadata preserved outside the declared JSON Schema fields.
    expect((format.json_schema as unknown as UnsafeMetadata)[nestedSymbol]).toBe('nested-preserved');
    expect(format.json_schema).not.toBe(originalNested);
    expect(original.type).toBe('text');
    expect(original.toJSON).toBe(rootSerializer);
    expect(originalNested.toJSON).toBe(nestedSerializer);
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(originalNested)).toBe(true);
    expect(format.$parseRaw(responseText)).toEqual({ city: 'Paris' });
    expect(parser).toHaveBeenCalledWith(responseText);
  });

  test('evaluates root and nested enumerable serializer getters only once', () => {
    const rootSerializer = vi.fn(() => ({ type: 'text' }));
    const nestedSerializer = vi.fn(() => ({ strict: false }));
    const rootGetter = vi.fn(() => rootSerializer);
    const nestedGetter = vi.fn(() => nestedSerializer);
    const nested = {
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: trustedSchema,
    };
    Object.defineProperty(nested, 'toJSON', { enumerable: true, get: nestedGetter });
    const original = { type: 'json_schema', json_schema: nested };
    Object.defineProperty(original, 'toJSON', { enumerable: true, get: rootGetter });
    Object.freeze(nested);
    Object.freeze(original);

    const format = makeParseableResponseFormat(
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Inject caller-owned serialization metadata beyond the declared format type to test boundary validation.
      original as unknown as Parameters<typeof makeParseableResponseFormat>[0],
      // SAFETY: The parser receives responseText from this suite, whose JSON object has the ParsedWeather city field.
      (value) => JSON.parse(value) as ParsedWeather,
    );

    expectTrustedFormat(format);
    expect(parseSerializedJSON(format)).toMatchObject({
      type: 'json_schema',
      json_schema: { name: trustedName, strict: true },
    });
    expect(rootGetter).toHaveBeenCalledTimes(1);
    expect(nestedGetter).toHaveBeenCalledTimes(1);
    expect(rootSerializer).not.toHaveBeenCalled();
    expect(nestedSerializer).not.toHaveBeenCalled();
  });

  test('removes inherited and hidden serializers from direct nested factory input', () => {
    const inheritedSerializer = vi.fn(() => ({ strict: false }));
    const hiddenSerializer = vi.fn(() => ({ strict: false }));
    const inherited = Object.assign(Object.create({ toJSON: inheritedSerializer }), {
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: trustedSchema,
    });
    const hidden = {
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: trustedSchema,
    };
    Object.defineProperty(hidden, 'toJSON', { enumerable: false, value: hiddenSerializer });

    for (const nested of [inherited, hidden]) {
      const format = makeParseableResponseFormat(
        // SAFETY: This caller-owned format fixture contains known schema fields plus deliberately hostile serialization hooks; only the factory validation consumes it.
        { type: 'json_schema', json_schema: nested } as Parameters<typeof makeParseableResponseFormat>[0],
        (value) => JSON.parse(value),
      );

      expectTrustedFormat(format);
      expect(parseSerializedJSON(format)).toMatchObject({
        json_schema: { name: trustedName, strict: true },
      });
    }

    expect(inheritedSerializer).not.toHaveBeenCalled();
    expect(hiddenSerializer).not.toHaveBeenCalled();
  });

  test('preserves exceptions thrown by original enumerable metadata getters', () => {
    const failure = new Error('synthetic nested metadata getter failure');
    const nested = {
      name: trustedName,
      strict: true,
      description: trustedDescription,
      schema: trustedSchema,
    };
    Object.defineProperty(nested, 'toJSON', {
      enumerable: true,
      get() {
        throw failure;
      },
    });

    expect(() =>
      makeParseableResponseFormat(
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: Inject caller-owned serialization metadata beyond the declared format type to test boundary validation.
        { type: 'json_schema', json_schema: nested } as unknown as Parameters<
          typeof makeParseableResponseFormat
        >[0],
        (value) => JSON.parse(value),
      ),
    ).toThrow(failure);
  });
});
