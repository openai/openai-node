import {
  zodFunction,
  zodRealtimeFunction,
  zodResponseFormat,
  zodResponsesFunction,
  zodTextFormat,
} from 'openai/helpers/zod';
import { z as zv4 } from 'zod/v4';
import { z as zv4Mini } from 'zod/v4-mini';

type JSONSchemaRecord = Record<string, unknown>;

function schemaProperties(schema: unknown): Record<string, JSONSchemaRecord> {
  return (schema as { properties: Record<string, JSONSchemaRecord> }).properties;
}

describe('Zod v4 schema reference literals', () => {
  const z = zv4;
  const referenceLiteral = () => z.object({ $ref: z.string() });
  const nestedReferenceLiteral = () => z.object({ $ref: z.string(), nested: referenceLiteral() });
  it('preserves literal defaults and caller-owned objects while escaping real definition references', () => {
    const Account = z.object({ id: z.string() });
    const definitionName = 'account/admin~team%2Fowner #';
    const literalRef = `#/definitions/${definitionName}`;
    const payload = {
      $ref: literalRef,
      tag: 'KEEP',
      nested: {
        $ref: literalRef,
        children: [
          {
            default: { $ref: literalRef },
            const: { $ref: literalRef },
            enum: [{ $ref: literalRef }],
            examples: [{ $ref: literalRef }],
          },
        ],
      },
    };
    const originalPayload = structuredClone(payload);
    const Root = z.object({
      account: Account,
      nested: z.object({ accounts: z.array(Account) }),
      payload: z
        .object({
          $ref: z.string(),
          tag: z.string(),
          nested: z.object({
            $ref: z.string(),
            children: z.array(
              z.object({
                default: referenceLiteral(),
                const: referenceLiteral(),
                enum: z.array(referenceLiteral()),
                examples: z.array(referenceLiteral()),
              }),
            ),
          }),
        })
        .default(payload),
    });

    const { schema } = zodResponseFormat(Root, 'account_response', {
      schemaDefinitions: { [definitionName]: Account },
    }).json_schema;
    const properties = schemaProperties(schema);

    expect(properties['payload']?.['default']).toEqual(originalPayload);
    expect(payload).toEqual(originalPayload);
    expect(Root.parse({ account: { id: 'first' }, nested: { accounts: [] } }).payload).toEqual(
      originalPayload,
    );

    const escapedRef = '#/definitions/account~1admin~0team%252Fowner%20%23';
    expect(properties['account']?.['$ref']).toBe(escapedRef);
    const nestedProperties = schemaProperties(properties['nested']);
    const nestedArray = nestedProperties['accounts'] as { items: { $ref: string } };
    expect(nestedArray.items.$ref).toBe(escapedRef);
  });

  it('preserves frozen defaults across response, text, chat, Responses, and realtime helpers', () => {
    const payload = Object.freeze({
      $ref: '#/definitions/account/admin',
      nested: Object.freeze({ $ref: '#/definitions/account/admin' }),
    });
    const Root = z.object({ payload: nestedReferenceLiteral().default(payload) });
    const helpers: (() => unknown)[] = [
      () => zodResponseFormat(Root, 'account').json_schema.schema,
      () => zodTextFormat(Root, 'account').schema,
      () => zodFunction({ name: 'account', parameters: Root }).function.parameters,
      () => zodResponsesFunction({ name: 'account', parameters: Root }).parameters,
      () => zodRealtimeFunction({ name: 'account', parameters: Root }).parameters,
    ];

    for (const generateSchema of helpers) {
      expect(generateSchema).not.toThrow();
      expect(schemaProperties(generateSchema())['payload']?.['default']).toEqual(payload);
    }

    expect(payload.$ref).toBe('#/definitions/account/admin');
  });

  it('preserves frozen literal defaults while escaping registered schema definitions', () => {
    const Account = z.object({ id: z.string() });
    const payload = Object.freeze({
      $ref: '#/definitions/account/admin',
      nested: Object.freeze({ $ref: '#/definitions/account/admin' }),
    });
    const Root = z.object({ account: Account, payload: nestedReferenceLiteral().default(payload) });

    const { schema } = zodResponseFormat(Root, 'account_response', {
      schemaDefinitions: { 'account/admin': Account },
    }).json_schema;
    const properties = schemaProperties(schema);

    expect(properties['account']?.['$ref']).toBe('#/definitions/account~1admin');
    expect(properties['payload']?.['default']).toEqual(payload);
    expect(payload.$ref).toBe('#/definitions/account/admin');
  });
});

describe('Zod v4 schema reference literals', () => {
  it('preserves default, const, enum, and examples metadata payloads', () => {
    const literal = { $ref: '#/definitions/account/admin', tag: 'KEEP' };
    const Root = zv4.object({
      payload: zv4.any().meta({
        default: literal,
        const: literal,
        enum: [literal],
        examples: [literal],
      }),
    });

    const { schema } = zodResponseFormat(Root, 'account_response').json_schema;
    const properties = schemaProperties(schema);

    expect(properties['payload']).toMatchObject({
      default: literal,
      const: literal,
      enum: [literal],
      examples: [literal],
    });
    expect(literal.$ref).toBe('#/definitions/account/admin');
  });

  it('preserves object-valued const and enum literals while escaping real references', () => {
    const Account = zv4.object({ id: zv4.string() });
    const literal = { $ref: '#/definitions/account/admin', tag: 'KEEP' };
    const alternateLiteral = { $ref: '#/definitions/account/admin', tag: 'ALSO KEEP' };
    const Root = zv4.object({
      account: Account,
      constant: zv4.literal(literal as unknown as string),
      enumeration: zv4.literal([literal, alternateLiteral] as unknown as readonly string[]),
    });

    const { schema } = zodResponseFormat(Root, 'account_response', {
      schemaDefinitions: { 'account/admin': Account },
    }).json_schema;
    const properties = schemaProperties(schema);

    expect(properties['account']?.['$ref']).toBe('#/definitions/account~1admin');
    expect(properties['constant']?.['const']).toEqual(literal);
    expect(properties['enumeration']?.['enum']).toEqual([literal, alternateLiteral]);
  });
});

it('preserves Zod v4 Mini literal defaults while escaping real definition references', () => {
  const Account = zv4Mini.object({ id: zv4Mini.string() });
  const literal = { $ref: '#/definitions/account/admin', tag: 'KEEP' };
  const Root = zv4Mini.object({
    account: Account,
    payload: zv4Mini._default(zv4Mini.any(), literal),
  });

  const { schema } = zodResponseFormat(Root, 'account_response', {
    schemaDefinitions: { 'account/admin': Account },
  }).json_schema;
  const properties = schemaProperties(schema);

  expect(properties['account']?.['$ref']).toBe('#/definitions/account~1admin');
  expect(properties['payload']?.['default']).toEqual(literal);
});
