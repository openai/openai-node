interface SchemaNode {
  _def: SchemaDefinition;
}

interface ZodV3Schema {
  _def: unknown;
}

interface SchemaDefinition {
  typeName: string;
  checks?: readonly { kind: string }[];
  shape: () => Record<string, SchemaNode>;
  type: SchemaNode;
  innerType: SchemaNode;
  valueType: SchemaNode;
  keyType: SchemaNode;
  items: readonly SchemaNode[];
  rest?: SchemaNode | null;
  options: readonly SchemaNode[] | Map<unknown, SchemaNode>;
  getter: () => SchemaNode;
  value?: unknown;
  values?: readonly unknown[] | Record<string, unknown>;
}

interface JSONDomain {
  type: 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string' | 'unknown';
  values?: ReadonlySet<string | number | boolean | null>;
  discriminators?: ReadonlyMap<string, JSONDomain>;
}

interface SchemaChild {
  schema: SchemaNode;
  path: string;
}

const simpleJSONDomains: Readonly<Record<string, JSONDomain['type']>> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBoolean: 'boolean',
  ZodNull: 'null',
  ZodObject: 'object',
  ZodRecord: 'object',
  ZodArray: 'array',
  ZodTuple: 'array',
};

const transparentWrappers = new Set(['ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodCatch', 'ZodReadonly']);

const supportedLeaves = new Set([
  'ZodString',
  'ZodNumber',
  'ZodBoolean',
  'ZodNull',
  'ZodEnum',
  'ZodNativeEnum',
  'ZodAny',
  'ZodUnknown',
  'ZodLiteral',
]);

const unsupportedReasons = new Map([
  ['ZodBigInt', 'encode integers as decimal strings and convert with BigInt after parsing'],
  ['ZodDate', 'native dates do not have a synchronous JSON representation'],
  ['ZodMap', 'native maps do not have a synchronous JSON representation'],
  ['ZodSet', 'native sets do not have a synchronous JSON representation'],
  ['ZodPromise', 'asynchronous values do not have a synchronous JSON representation'],
  ['ZodEffects', 'custom transformations and refinements are opaque to JSON Schema'],
  ['ZodPipeline', 'custom pipelines are opaque to JSON Schema'],
  ['ZodIntersection', 'intersections cannot prove that both branches produce the same value'],
]);

const valueChangingStringChecks = new Set(['trim', 'toLowerCase', 'toUpperCase']);

function unsupported(path: string, kind: string, explanation: string): never {
  throw new Error(
    `Zod schema field \`${path}\` uses \`${kind}\`, which cannot be represented by strict Structured Outputs: ${explanation}`,
  );
}

function literalDomain(value: unknown): JSONDomain | undefined {
  if (value === null) {
    return { type: 'null', values: new Set([null]) };
  }
  if (typeof value === 'string') {
    return { type: 'string', values: new Set([value]) };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', values: new Set([value]) };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { type: 'number', values: new Set([value]) };
  }
  return undefined;
}

function nativeEnumDomains(def: SchemaDefinition): JSONDomain[] {
  const values = Object.values(def.values ?? {}).filter(
    (value): value is string | number => typeof value === 'string' || typeof value === 'number',
  );
  return (['string', 'number'] as const)
    .map((type) => ({
      type,
      values: new Set(values.filter((value) => typeof value === type)),
    }))
    .filter((domain) => domain.values.size > 0);
}

function objectDomain(def: SchemaDefinition): JSONDomain {
  const discriminators = new Map<string, JSONDomain>();
  for (const [name, child] of Object.entries(def.shape())) {
    if (child._def.typeName !== 'ZodLiteral') {
      continue;
    }
    const domain = literalDomain(child._def.value);
    if (domain) {
      discriminators.set(name, domain);
    }
  }
  return { type: 'object', discriminators };
}

function domainsFor(schema: SchemaNode, seen = new Set<SchemaDefinition>()): JSONDomain[] {
  const def = schema._def;
  if (seen.has(def)) {
    return [{ type: 'unknown' }];
  }
  seen.add(def);

  if (def.typeName === 'ZodObject') {
    return [objectDomain(def)];
  }
  const simpleDomain = simpleJSONDomains[def.typeName];
  if (simpleDomain !== undefined) {
    return [{ type: simpleDomain }];
  }
  if (def.typeName === 'ZodLiteral') {
    const domain = literalDomain(def.value);
    return domain ? [domain] : [{ type: 'unknown' }];
  }
  if (def.typeName === 'ZodEnum') {
    const values = Array.isArray(def.values)
      ? def.values.filter((value): value is string => typeof value === 'string')
      : [];
    return [{ type: 'string', values: new Set(values) }];
  }
  if (def.typeName === 'ZodNativeEnum') {
    return nativeEnumDomains(def);
  }
  if (def.typeName === 'ZodNullable') {
    return [...domainsFor(def.innerType, new Set(seen)), { type: 'null' }];
  }
  if (transparentWrappers.has(def.typeName)) {
    return domainsFor(def.innerType, seen);
  }
  if (def.typeName === 'ZodBranded') {
    return domainsFor(def.type, seen);
  }
  if (def.typeName === 'ZodLazy') {
    return domainsFor(def.getter(), seen);
  }
  return [{ type: 'unknown' }];
}

function domainsOverlap(left: JSONDomain, right: JSONDomain): boolean {
  if (left.type === 'unknown' || right.type === 'unknown') {
    return true;
  }
  if (left.type !== right.type) {
    return false;
  }

  if (left.discriminators && right.discriminators) {
    for (const [name, first] of left.discriminators) {
      const second = right.discriminators.get(name);
      if (second && !domainsOverlap(first, second)) {
        return false;
      }
    }
  }

  const rightValues = right.values;
  if (!left.values || !rightValues) {
    return true;
  }
  return [...left.values].some((value) => rightValues.has(value));
}

function assertUnambiguousUnion(options: readonly SchemaNode[], path: string): void {
  const domains = options.map((option) => domainsFor(option));

  for (const [index, left] of domains.entries()) {
    for (const right of domains.slice(index + 1)) {
      if (left.some((first) => right.some((second) => domainsOverlap(first, second)))) {
        unsupported(
          path,
          'ZodUnion',
          'ambiguous union branches overlap; use disjoint JSON types, distinct literals, or a discriminated union',
        );
      }
    }
  }
}

function schemaChildren(def: SchemaDefinition, path: string): SchemaChild[] | undefined {
  switch (def.typeName) {
    case 'ZodObject': {
      return Object.entries(def.shape()).map(([name, schema]) => ({
        schema,
        path: `${path}.${name}`,
      }));
    }
    case 'ZodArray': {
      return [{ schema: def.type, path: `${path}[]` }];
    }
    case 'ZodTuple': {
      const children = def.items.map((schema, index) => ({
        schema,
        path: `${path}[${index}]`,
      }));
      if (def.rest) {
        children.push({ schema: def.rest, path: `${path}[]` });
      }
      return children;
    }
    case 'ZodRecord': {
      return [
        { schema: def.keyType, path: `${path}.<key>` },
        { schema: def.valueType, path: `${path}.<value>` },
      ];
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      return [...def.options.values()].map((schema, index) => ({
        schema,
        path: `${path}[${index}]`,
      }));
    }
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly': {
      return [{ schema: def.innerType, path }];
    }
    case 'ZodBranded': {
      return [{ schema: def.type, path }];
    }
    case 'ZodLazy': {
      return [{ schema: def.getter(), path }];
    }
    default: {
      return undefined;
    }
  }
}

function visit(schema: SchemaNode, path: string, visited: Set<SchemaDefinition>): void {
  const def = schema._def;
  if (visited.has(def)) {
    return;
  }
  visited.add(def);

  // Preserve the existing concrete-root diagnostic for intersections.
  if (def.typeName === 'ZodIntersection' && path === '$') {
    return;
  }

  const rejection = unsupportedReasons.get(def.typeName);
  if (rejection) {
    unsupported(path, def.typeName, rejection);
  }
  if (def.typeName === 'ZodLiteral' && !literalDomain(def.value)) {
    unsupported(path, def.typeName, 'literal values must be finite JSON primitives');
  }
  if (def.typeName === 'ZodString' && def.checks?.some(({ kind }) => valueChangingStringChecks.has(kind))) {
    unsupported(path, def.typeName, 'value-changing string checks are not represented in JSON Schema');
  }

  const children = schemaChildren(def, path);
  if (!children) {
    if (!supportedLeaves.has(def.typeName)) {
      unsupported(path, def.typeName, 'this Zod schema is outside the documented JSON-native subset');
    }
    return;
  }

  for (const child of children) {
    visit(child.schema, child.path, visited);
  }
  if (def.typeName === 'ZodUnion' && path !== '$') {
    assertUnambiguousUnion(
      children.map(({ schema: child }) => child),
      path,
    );
  }
}

export function assertSupportedZodV3Schema(
  schema: ZodV3Schema,
  definitions: Record<string, ZodV3Schema> | undefined,
): void {
  const visited = new Set<SchemaDefinition>();
  visit(schema as unknown as SchemaNode, '$', visited);
  for (const [name, definition] of Object.entries(definitions ?? {})) {
    visit(definition as unknown as SchemaNode, `$.definitions.${name}`, visited);
  }
}

export function assertJSONSerializableSchema(
  value: unknown,
  path = '$',
  ancestors = new Set<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError(
      `Strict Structured Outputs schema field \`${path}\` contains a non-JSON ${typeof value} value`,
    );
  }
  if (ancestors.has(value)) {
    throw new Error(`Strict Structured Outputs schema field \`${path}\` contains a circular JSON value`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Strict Structured Outputs schema field \`${path}\` contains a non-JSON native object`);
  }

  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertJSONSerializableSchema(child, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}
