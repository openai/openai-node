interface SchemaNode {
  _def: SchemaDefinition;
}

interface ZodV3Schema {
  _def: unknown;
}

interface SchemaDefinition {
  typeName: string;
  checks?: readonly { kind: string; value?: unknown }[];
  coerce?: boolean;
  shape: () => Record<string, SchemaNode>;
  type: SchemaNode;
  innerType: SchemaNode;
  catchall?: SchemaNode;
  unknownKeys?: string;
  options: readonly SchemaNode[] | Map<unknown, SchemaNode>;
  getter: () => SchemaNode;
  value?: unknown;
  values?: readonly unknown[] | Record<string, unknown>;
}

interface JSONDomain {
  type: 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string' | 'unknown';
  values?: ReadonlySet<string | number | boolean | null>;
  discriminators?: ReadonlyMap<string, readonly JSONDomain[]>;
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
  ZodArray: 'array',
};

const transparentWrappers = new Set(['ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodReadonly']);

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
  ['ZodCatch', 'catch fallbacks cannot be proven to produce JSON-native values'],
  ['ZodTuple', 'tuple schemas require unsupported array-valued items'],
  ['ZodRecord', 'open-ended record schemas require unsupported additionalProperties'],
]);

const valueChangingStringChecks = new Set(['trim', 'toLowerCase', 'toUpperCase']);
const patternProducingStringChecks = new Set([
  'regex',
  'cuid',
  'cuid2',
  'startsWith',
  'endsWith',
  'includes',
  'emoji',
  'ulid',
  'nanoid',
]);

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
  const definitionValues = def.values;
  if (!definitionValues || Array.isArray(definitionValues)) {
    return [];
  }
  const object = definitionValues as Record<string, unknown>;
  const values = Object.keys(object)
    .filter((key) => {
      const value = object[key];
      return (
        (typeof value === 'string' || typeof value === 'number') && typeof object[String(value)] !== 'number'
      );
    })
    .map((key) => object[key])
    .filter(
      (value): value is string | number =>
        typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)),
    );
  return (['string', 'number'] as const)
    .map((type) => ({
      type,
      values: new Set(values.filter((value) => typeof value === type)),
    }))
    .filter((domain) => domain.values.size > 0);
}

function stringEnumDomain(def: SchemaDefinition): JSONDomain {
  const values = Array.isArray(def.values)
    ? def.values.filter((value): value is string => typeof value === 'string')
    : [];
  return { type: 'string', values: new Set(values) };
}

function finiteDiscriminatorDomains(def: SchemaDefinition): JSONDomain[] {
  if (def.typeName === 'ZodLiteral') {
    const domain = literalDomain(def.value);
    return domain ? [domain] : [];
  }
  if (def.typeName === 'ZodEnum') {
    return [stringEnumDomain(def)];
  }
  return def.typeName === 'ZodNativeEnum' ? nativeEnumDomains(def) : [];
}

function objectDomain(def: SchemaDefinition): JSONDomain {
  const discriminators = new Map<string, readonly JSONDomain[]>();
  for (const [name, child] of Object.entries(def.shape())) {
    const domains = finiteDiscriminatorDomains(child._def);
    if (domains.length > 0 && domains.every(({ values }) => values !== undefined && values.size > 0)) {
      discriminators.set(name, domains);
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
    return [stringEnumDomain(def)];
  }
  if (def.typeName === 'ZodNativeEnum') {
    return nativeEnumDomains(def);
  }
  if (def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion') {
    return [...def.options.values()].flatMap((option) => domainsFor(option, new Set(seen)));
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
      if (
        second &&
        !first.some((leftDomain) => second.some((rightDomain) => domainsOverlap(leftDomain, rightDomain)))
      ) {
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
      const children = Object.entries(def.shape()).map(([name, schema]) => ({
        schema,
        path: `${path}.${name}`,
      }));
      if (def.catchall && def.catchall._def.typeName !== 'ZodNever') {
        children.push({ schema: def.catchall, path: `${path}.<catchall>` });
      }
      return children;
    }
    case 'ZodArray': {
      return [{ schema: def.type, path: `${path}[]` }];
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

function hasFiniteNumberOutput(def: SchemaDefinition): boolean {
  const checks = def.checks ?? [];
  if (checks.some(({ kind }) => kind === 'finite' || kind === 'int')) {
    return true;
  }
  return (
    checks.some(({ kind, value }) => kind === 'min' && typeof value === 'number' && Number.isFinite(value)) &&
    checks.some(({ kind, value }) => kind === 'max' && typeof value === 'number' && Number.isFinite(value))
  );
}

function hasClosedJSONNativeObjectOutput(
  def: SchemaDefinition,
  active: Set<SchemaDefinition>,
  inspect: (schema: SchemaNode, active: Set<SchemaDefinition>) => boolean,
): boolean {
  return (
    def.unknownKeys !== 'passthrough' &&
    (def.catchall === undefined || def.catchall._def.typeName === 'ZodNever') &&
    Object.values(def.shape()).every((child) => inspect(child, new Set(active)))
  );
}

function hasProvablyJSONNativeOutput(schema: SchemaNode, active = new Set<SchemaDefinition>()): boolean {
  const def = schema._def;
  if (active.has(def)) {
    return true;
  }
  active.add(def);

  switch (def.typeName) {
    case 'ZodString':
    case 'ZodBoolean':
    case 'ZodNull':
    case 'ZodEnum':
    case 'ZodNativeEnum': {
      return true;
    }
    case 'ZodLiteral': {
      return literalDomain(def.value) !== undefined;
    }
    case 'ZodNumber': {
      return hasFiniteNumberOutput(def);
    }
    case 'ZodArray': {
      return hasProvablyJSONNativeOutput(def.type, active);
    }
    case 'ZodObject': {
      return hasClosedJSONNativeObjectOutput(def, active, hasProvablyJSONNativeOutput);
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      return [...def.options.values()].every((child) => hasProvablyJSONNativeOutput(child, new Set(active)));
    }
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodReadonly': {
      return hasProvablyJSONNativeOutput(def.innerType, active);
    }
    case 'ZodBranded': {
      return hasProvablyJSONNativeOutput(def.type, active);
    }
    case 'ZodLazy': {
      return hasProvablyJSONNativeOutput(def.getter(), active);
    }
    default: {
      return false;
    }
  }
}

function assertSupportedSchemaValue(def: SchemaDefinition, path: string): void {
  const rejection = unsupportedReasons.get(def.typeName);
  if (rejection) {
    unsupported(path, def.typeName, rejection);
  }
  if (def.typeName === 'ZodLiteral' && !literalDomain(def.value)) {
    unsupported(path, def.typeName, 'literal values must be finite JSON primitives');
  }
  if (def.typeName === 'ZodNumber' && def.coerce === true && !hasFiniteNumberOutput(def)) {
    unsupported(path, def.typeName, 'number coercion must prove its parsed output is finite');
  }
  if (def.typeName === 'ZodDefault' && !hasProvablyJSONNativeOutput(def.innerType)) {
    unsupported(
      path,
      def.typeName,
      'default factory output is not independently guaranteed to be finite and JSON-native; it may contain bigint',
    );
  }
  if (def.typeName === 'ZodString' && def.checks?.some(({ kind }) => valueChangingStringChecks.has(kind))) {
    unsupported(path, def.typeName, 'value-changing string checks are not represented in JSON Schema');
  }
  if (
    def.typeName === 'ZodString' &&
    (def.checks?.filter(({ kind }) => patternProducingStringChecks.has(kind)).length ?? 0) > 1
  ) {
    unsupported(path, def.typeName, 'multiple pattern-producing checks require unsupported allOf');
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

  assertSupportedSchemaValue(def, path);

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
  if (
    def.typeName === 'ZodObject' &&
    (def.unknownKeys === 'passthrough' ||
      (def.catchall !== undefined && def.catchall._def.typeName !== 'ZodNever'))
  ) {
    unsupported(path, def.typeName, 'open object schemas require additionalProperties: false');
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

function assertNoJSONSerializationHook(value: object, path: string): void {
  for (let current: object | null = value; current !== null; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'toJSON');
    if (!descriptor) {
      continue;
    }
    if (!('value' in descriptor) || typeof descriptor.value === 'function') {
      throw new Error(
        `Strict Structured Outputs schema field \`${path}\` contains an unsupported \`toJSON\` serialization hook`,
      );
    }
    return;
  }
}

function assertJSONSerializableNumber(value: number, path: string): void {
  if (Object.is(value, -0)) {
    throw new TypeError(
      `Strict Structured Outputs schema field \`${path}\` contains negative zero, which cannot round-trip through JSON`,
    );
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
    assertJSONSerializableNumber(value, path);
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
  assertNoJSONSerializationHook(value, path);

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor) {
        throw new Error(
          `Strict Structured Outputs schema field \`${path}[${index}]\` contains a sparse array`,
        );
      }
      if (!('value' in descriptor)) {
        throw new Error(
          `Strict Structured Outputs schema field \`${path}[${index}]\` contains an array accessor`,
        );
      }
      assertJSONSerializableSchema(descriptor.value, `${path}[${index}]`, ancestors);
    }
  } else {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new Error(`Strict Structured Outputs schema field \`${path}.${key}\` contains an accessor`);
      }
      assertJSONSerializableSchema(descriptor.value, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}
