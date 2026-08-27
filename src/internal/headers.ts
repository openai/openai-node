import { assertAzureCredentialHeaderValue, isAzureAuthenticationHeader } from './azure';
import type { FinalRequestOptions } from './request-options';
import { isReadonlyArray } from './utils/values';

type HeaderValue = string | undefined | null;
export type HeadersLike =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>
  | undefined
  | null
  | NullableHeaders;

const brand_privateNullableHeaders = /* @__PURE__ */ Symbol('brand.privateNullableHeaders');
const httpTokenHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const intrinsicSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get;

/**
 * @internal
 * Users can pass explicit nulls to unset default headers. When we parse them
 * into a standard headers type we need to preserve that information.
 */
export type NullableHeaders = {
  /** Brand check, prevent users from creating a NullableHeaders. */
  [brand_privateNullableHeaders]: true;
  /** Parsed headers. */
  values: Headers;
  /** Set of lowercase header names explicitly set to null. */
  nulls: Set<string>;
};

type AzureAuthenticationValues = ReadonlyArray<HeadersLike>;
type AzureAuthenticationLayer = ReadonlyArray<readonly [string, string | null]>;
type AzureAuthenticationRecordSnapshot = {
  descriptors: Record<string, PropertyDescriptor>;
  keys: readonly string[];
};
type AzureAuthenticationHeaderMutation = {
  kind: 'append' | 'replace' | 'delete';
  values: string[];
};
type AzureAuthenticationHeaderIteratorResult = IteratorResult<[string, string] | string>;

type AzureRequestHeaderMarker = {
  active: boolean;
  reserved: boolean;
  registration: AzureRequestHeaderRegistration;
};
type AzureRequestHeaderRegistration = {
  carrier: NullableHeaders;
  headers: object;
  owner: object | undefined;
  record: AzureAuthenticationRecordSnapshot | undefined;
};
type AzureRequestHeaderRegistrations = {
  references: number;
  markers: AzureRequestHeaderMarker[];
  registrations: Set<AzureRequestHeaderRegistration>;
};
type AzureRequestHeaderProtection = {
  bind: (carrier: NullableHeaders) => NullableHeaders;
  deactivate: () => void;
  release: () => void;
  snapshot: () => void;
};
type AzureRequestHeaderSnapshot = {
  authenticate: (
    authentication: (
      options: FinalRequestOptions,
      schemes?: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
    ) => Promise<NullableHeaders | undefined>,
    schemes: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean },
  ) => Promise<NullableHeaders | undefined>;
  headers: () => HeadersLike;
};
type AzureRequestHeaderSnapshotContext = {
  client: object;
  snapshot: AzureRequestHeaderSnapshot;
};

// Object-identity branding cannot be forged by caller-provided header records.
const azureAuthenticationHeaders = new WeakMap<NullableHeaders, AzureAuthenticationValues>();
const azureAuthenticationHeaderCarriers = new WeakMap<Headers, NullableHeaders>();
const azureAuthenticationHeaderSnapshots = new WeakMap<
  NullableHeaders,
  ReadonlyArray<AzureAuthenticationLayer>
>();
const azureAuthenticationHeaderRecordSnapshots = new WeakMap<
  NullableHeaders,
  WeakMap<object, AzureAuthenticationRecordSnapshot>
>();
const azureAuthenticationHeaderMutations = new WeakMap<
  Headers,
  Map<string, AzureAuthenticationHeaderMutation>
>();
const azureAuthenticationMaterializedHeaders = new WeakMap<Headers, Set<string>>();
const azureAuthenticationUnmaterializedHeaders = new WeakMap<Headers, Set<string>>();
const azureAuthenticationMutationNativeValues = new WeakMap<Headers, Map<string, string | null>>();
const azureAuthenticationHeaderMutationVersions = new WeakMap<Headers, number>();
const azureAuthenticationHeaderIteratorStates = new WeakMap<
  object,
  () => AzureAuthenticationHeaderIteratorResult
>();
const azureAuthenticationHeaderIteratorPrototypes = new WeakMap<object, object>();

const azureAuthenticationNullCarriers = new WeakMap<Set<string>, NullableHeaders>();
const azureRequestHeaders = new WeakMap<object, AzureRequestHeaderRegistrations>();
const azureRequestAuthenticationHeaders = new WeakMap<NullableHeaders, AzureRequestHeaderRegistration>();
const azureRequestHeaderSnapshots = new WeakMap<object, AzureRequestHeaderSnapshotContext[]>();

const snapshotAzureAuthenticationHeaders = (
  carrier: NullableHeaders,
  registration?: AzureRequestHeaderRegistration,
): ReadonlyArray<AzureAuthenticationLayer> | undefined => {
  const headers = azureAuthenticationHeaders.get(carrier);
  if (headers === undefined) return undefined;
  const records = azureAuthenticationHeaderRecordSnapshots.get(carrier);

  let layers = azureAuthenticationHeaderSnapshots.get(carrier);
  if (!layers) {
    layers = Object.freeze(
      headers.map((layer) => {
        const record = layer !== null && typeof layer === 'object' ? records?.get(layer) : undefined;
        return Object.freeze(
          Array.from(iterateHeaders(layer, registration, record), ([name, value]) => {
            const normalized = name.toLowerCase();
            return registration !== undefined &&
              value !== null &&
              typeof value !== 'string' &&
              isAzureAuthenticationHeader(normalized) &&
              !hasRemainingAzureAuthenticationOverride(layer, name, normalized, registration, record)
              ? ([name, coerceAzureCredentialHeaderValue(value)] as const)
              : ([name, value] as const);
          }),
        );
      }),
    );
    azureAuthenticationHeaderSnapshots.set(carrier, layers);
  }
  return layers;
};

const coerceAzureCredentialHeaderValue = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
};

const invalidateAzureAuthenticationHeaderIterators = (headers: Headers): void => {
  const version = azureAuthenticationHeaderMutationVersions.get(headers) ?? 0;
  azureAuthenticationHeaderMutationVersions.set(headers, version + 1);
};

const azureAuthenticationHeaderIteratorPrototype = (iterator: object): object => {
  const intrinsic = Object.getPrototypeOf(iterator) as object;
  let prototype = azureAuthenticationHeaderIteratorPrototypes.get(intrinsic);
  if (prototype !== undefined) return prototype;

  const nativeNext = Reflect.get(intrinsic, 'next') as () => AzureAuthenticationHeaderIteratorResult;
  prototype = Object.create(intrinsic) as object;
  Object.defineProperty(prototype, 'next', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function next(this: object): AzureAuthenticationHeaderIteratorResult {
      const advance = azureAuthenticationHeaderIteratorStates.get(this);
      return advance === undefined ? Reflect.apply(nativeNext, this, []) : advance();
    },
  });
  azureAuthenticationHeaderIteratorPrototypes.set(intrinsic, prototype);
  return prototype;
};

class DeferredAzureAuthenticationHeaders extends Headers {
  constructor() {
    super();
    azureAuthenticationHeaderMutations.set(this, new Map());
    azureAuthenticationMutationNativeValues.set(this, new Map());
  }

  static {
    Object.defineProperties(this.prototype, {
      get: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders, name: string): string | null {
          const normalized = String(name).toLowerCase();
          Headers.prototype.has.call(this, normalized);
          return this.current().get(normalized) ?? null;
        },
      },
      getSetCookie: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders): string[] {
          return this.cookieValues();
        },
      },
      has: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders, name: string): boolean {
          const normalized = String(name).toLowerCase();
          Headers.prototype.has.call(this, normalized);
          return this.current().has(normalized);
        },
      },
      entries: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders): ReturnType<Headers['entries']> {
          return this.iterator('entries');
        },
      },
      keys: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders): ReturnType<Headers['keys']> {
          return this.iterator('keys');
        },
      },
      values: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders): ReturnType<Headers['values']> {
          return this.iterator('values');
        },
      },
      [Symbol.iterator]: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders): ReturnType<Headers[typeof Symbol.iterator]> {
          return this.entries();
        },
      },
      forEach: {
        configurable: true,
        writable: true,
        value(
          this: DeferredAzureAuthenticationHeaders,
          callback: (value: string, key: string, parent: Headers) => void,
          thisArg?: unknown,
        ): void {
          for (const [name, value] of this.entries()) {
            callback.call(thisArg, value, name, this);
          }
        },
      },
      append: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders, name: string, value: string): void {
          this.update(name, value, 'append');
        },
      },
      set: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders, name: string, value: string): void {
          this.update(name, value, 'replace');
        },
      },
      delete: {
        configurable: true,
        writable: true,
        value(this: DeferredAzureAuthenticationHeaders, name: string): void {
          const normalized = String(name).toLowerCase();
          const mutations = azureAuthenticationHeaderMutations.get(this);
          const previous = mutations?.get(normalized);
          const existed = Headers.prototype.has.call(this, normalized);
          Headers.prototype.delete.call(this, normalized);
          mutations?.set(normalized, { kind: 'delete', values: [] });
          azureAuthenticationMutationNativeValues.get(this)?.set(normalized, null);
          if (existed || previous?.kind !== 'delete') {
            invalidateAzureAuthenticationHeaderIterators(this);
          }
        },
      },
    });
  }

  private cookieValues(): string[] {
    Headers.prototype.has.call(this, 'set-cookie');
    const carrier = azureAuthenticationHeaderCarriers.get(this);
    const source = carrier ? iterateHeaders(carrier) : Headers.prototype.entries.call(this);
    const cookies: string[] = [];

    for (const [name, value] of source) {
      if (name.toLowerCase() !== 'set-cookie') {
        continue;
      }
      if (value === null) {
        cookies.length = 0;
        continue;
      }
      const normalized = new Headers([['set-cookie', value]]).get('set-cookie');
      if (normalized !== null) {
        cookies.push(normalized);
      }
    }

    return cookies;
  }

  private iterator(kind: 'entries'): ReturnType<Headers['entries']>;
  private iterator(kind: 'keys'): ReturnType<Headers['keys']>;
  private iterator(kind: 'values'): ReturnType<Headers['values']>;
  private iterator(
    kind: 'entries' | 'keys' | 'values',
  ): ReturnType<Headers['entries']> | ReturnType<Headers['keys']> | ReturnType<Headers['values']> {
    const iterator =
      kind === 'entries'
        ? Headers.prototype.entries.call(this)
        : kind === 'keys'
          ? Headers.prototype.keys.call(this)
          : Headers.prototype.values.call(this);
    let entries: [string, string][] = [];
    let nativeEntries: [string, string][] = [];
    let nativeValues = new Map<string, string>();
    let nativeObserver = Headers.prototype.entries.call(this);
    let nativeIndex = 0;
    let nullNames = new Set<string>();
    let nullCount = 0;
    let version: number | undefined;
    let index = 0;
    const carrier = azureAuthenticationHeaderCarriers.get(this);
    const readNullCount = (): number =>
      carrier !== undefined && intrinsicSetSize !== undefined
        ? (Reflect.apply(intrinsicSetSize, carrier.nulls, []) as number)
        : 0;

    const next = (): AzureAuthenticationHeaderIteratorResult => {
      const currentVersion = azureAuthenticationHeaderMutationVersions.get(this) ?? 0;
      let changed = version !== currentVersion || readNullCount() !== nullCount;
      if (!changed) {
        const observed = nativeObserver.next();
        const expected = nativeEntries[nativeIndex];
        changed = observed.done
          ? expected !== undefined
          : expected === undefined || observed.value[0] !== expected[0] || observed.value[1] !== expected[1];
        if (!changed && !observed.done && carrier !== undefined) {
          changed =
            nullNames.has(observed.value[0]) !== Set.prototype.has.call(carrier.nulls, observed.value[0]);
        }
        if (!observed.done) nativeIndex += 1;

        for (const candidate of [entries[index], entries[index - 1]]) {
          if (changed || candidate === undefined) continue;
          const previous = nativeValues.get(candidate[0]) ?? null;
          const hidden = carrier === undefined ? false : Set.prototype.has.call(carrier.nulls, candidate[0]);
          changed =
            Headers.prototype.get.call(this, candidate[0]) !== previous ||
            nullNames.has(candidate[0]) !== hidden;
        }
      }
      if (changed) {
        entries = [...this.current()];
        const cookies = entries.findIndex(([name]) => name === 'set-cookie');
        if (cookies !== -1) {
          entries.splice(
            cookies,
            1,
            ...this.cookieValues().map((value): [string, string] => ['set-cookie', value]),
          );
        }
        nativeEntries = [...Headers.prototype.entries.call(this)];
        nativeValues = new Map(nativeEntries);
        const nativeCookies = Headers.prototype.get.call(this, 'set-cookie');
        if (nativeCookies !== null) {
          nativeValues.set('set-cookie', nativeCookies);
        }
        nativeObserver = Headers.prototype.entries.call(this);
        nativeIndex = 0;
        nullNames = new Set(carrier === undefined ? [] : Set.prototype.values.call(carrier.nulls));
        nullCount = readNullCount();
        version = azureAuthenticationHeaderMutationVersions.get(this) ?? currentVersion;
      }

      const entry = entries[index];
      if (entry === undefined) {
        return { value: undefined, done: true };
      }
      if (changed) {
        const consumed = new Set(entries.slice(0, index + 1).map(([name]) => name));
        let nativeEntry = nativeEntries[nativeIndex];
        while (nativeEntry !== undefined && consumed.has(nativeEntry[0])) {
          nativeObserver.next();
          nativeIndex += 1;
          nativeEntry = nativeEntries[nativeIndex];
        }
      }
      index += 1;
      const value = kind === 'keys' ? entry[0] : kind === 'values' ? entry[1] : entry;
      return { value, done: false };
    };
    Object.setPrototypeOf(iterator, azureAuthenticationHeaderIteratorPrototype(iterator));
    azureAuthenticationHeaderIteratorStates.set(iterator, next);

    return iterator;
  }

  private current(): Map<string, string> {
    const carrier = azureAuthenticationHeaderCarriers.get(this);
    const source = carrier ? iterateHeaders(carrier) : Headers.prototype.entries.call(this);
    const effective = new Map<string, string>();
    for (const [name, value] of source) {
      const normalized = name.toLowerCase();
      if (value === null) {
        effective.delete(normalized);
        continue;
      }
      const normalizedValue = isAzureAuthenticationHeader(normalized)
        ? coerceAzureCredentialHeaderValue(value).replace(/^[\t ]+|[\t ]+$/g, '')
        : value;
      const previous = effective.get(normalized);
      effective.set(normalized, previous === undefined ? normalizedValue : `${previous}, ${normalizedValue}`);
    }
    return new Map([...effective].sort(([left], [right]) => Number(left > right) - Number(left < right)));
  }

  private update(name: string, value: string, operation: 'append' | 'replace'): void {
    const normalized = String(name).toLowerCase();
    const authentication = isAzureAuthenticationHeader(normalized);
    const normalizedValue = authentication ? coerceAzureCredentialHeaderValue(value) : value;
    const previousValue = Headers.prototype.get.call(this, normalized);
    let safe = true;

    if (authentication) {
      try {
        assertAzureCredentialHeaderValue(normalizedValue);
      } catch {
        safe = false;
      }
    }

    if (safe) {
      if (operation === 'append') {
        Headers.prototype.append.call(this, normalized, normalizedValue);
      } else {
        Headers.prototype.set.call(this, normalized, normalizedValue);
      }
    } else if (operation === 'replace') {
      Headers.prototype.delete.call(this, normalized);
    } else {
      Headers.prototype.has.call(this, normalized);
    }

    const mutations = azureAuthenticationHeaderMutations.get(this);
    if (!mutations) return;
    const previous = mutations.get(normalized);
    const kind =
      operation === 'replace' || previous?.kind === 'delete' || previous?.kind === 'replace'
        ? 'replace'
        : 'append';
    const previousValues = operation === 'replace' || previous?.kind === 'delete' ? [] : previous?.values;
    mutations.set(normalized, {
      kind,
      values: authentication ? [...(previousValues ?? []), normalizedValue] : [],
    });
    azureAuthenticationMutationNativeValues
      .get(this)
      ?.set(normalized, Headers.prototype.get.call(this, normalized));
    const unchanged =
      operation === 'replace' &&
      previousValue !== null &&
      previousValue === Headers.prototype.get.call(this, normalized) &&
      previous?.kind !== 'append' &&
      (!authentication ||
        (previous?.kind === 'replace' &&
          previous.values.length === 1 &&
          previous.values[0] === normalizedValue));
    if (!unchanged) {
      invalidateAzureAuthenticationHeaderIterators(this);
    }
  }
}

class DeferredAzureAuthenticationNulls extends Set<string> {
  private initialized = false;
  private readonly inherited = new Set<string>();

  static {
    const operations = [
      'union',
      'intersection',
      'difference',
      'symmetricDifference',
      'isSubsetOf',
      'isSupersetOf',
      'isDisjointFrom',
    ] as const;
    for (const name of operations) {
      const operation = Object.getOwnPropertyDescriptor(Set.prototype, name)?.value;
      if (typeof operation !== 'function') {
        continue;
      }
      Object.defineProperty(this.prototype, name, {
        configurable: true,
        value: this.wrapModernOperation(operation),
        writable: true,
      });
    }
  }

  private static wrapModernOperation(operation: (...values: unknown[]) => unknown) {
    return function (this: DeferredAzureAuthenticationNulls, other: unknown): unknown {
      this.initialize();
      return Reflect.apply(operation, this, [other]);
    };
  }

  seedInherited(name: string, present: boolean): void {
    if (present) {
      Set.prototype.add.call(this, name);
      this.inherited.add(name);
    } else {
      Set.prototype.delete.call(this, name);
      this.inherited.delete(name);
    }
  }

  private initialize(): void {
    const carrier = azureAuthenticationNullCarriers.get(this);
    if (!carrier) return;
    const removed = new Set<string>();
    for (const name of this.inherited) {
      if (!Set.prototype.has.call(this, name)) {
        this.inherited.delete(name);
        removed.add(name);
        if (azureAuthenticationHeaderMutations.get(carrier.values)?.get(name) === undefined) {
          carrier.values.delete(name);
        }
      }
    }
    if (this.initialized) return;
    this.initialized = true;

    for (const layer of snapshotAzureAuthenticationHeaders(carrier) ?? []) {
      for (const [name, value] of layer) {
        const normalized = name.toLowerCase();
        if (removed.has(normalized)) continue;
        if (value === null) {
          super.add(normalized);
          this.inherited.add(normalized);
        } else {
          super.delete(normalized);
          this.inherited.delete(normalized);
        }
      }
    }
  }

  override get size(): number {
    this.initialize();
    return super.size;
  }

  override has(value: string): boolean {
    this.initialize();
    return super.has(value);
  }

  override entries(): ReturnType<Set<string>['entries']> {
    this.initialize();
    return super.entries();
  }

  override keys(): ReturnType<Set<string>['keys']> {
    this.initialize();
    return super.keys();
  }

  override values(): ReturnType<Set<string>['values']> {
    this.initialize();
    return super.values();
  }

  override [Symbol.iterator](): ReturnType<Set<string>[typeof Symbol.iterator]> {
    this.initialize();
    return super[Symbol.iterator]();
  }

  override forEach(
    callback: (value: string, key: string, parent: Set<string>) => void,
    thisArg?: unknown,
  ): void {
    this.initialize();
    super.forEach(callback, thisArg);
  }

  override add(value: string): this {
    this.initialize();
    const size = super.size;
    super.add(value);
    const carrier = azureAuthenticationNullCarriers.get(this);
    if (carrier && super.size !== size) {
      invalidateAzureAuthenticationHeaderIterators(carrier.values);
    }
    return this;
  }

  override delete(value: string): boolean {
    this.initialize();
    const removed = super.delete(value);
    const carrier = azureAuthenticationNullCarriers.get(this);
    if (removed && this.inherited.delete(value)) {
      carrier?.values.delete(value);
    }
    if (removed && carrier) {
      invalidateAzureAuthenticationHeaderIterators(carrier.values);
    }
    return removed;
  }

  override clear(): void {
    this.initialize();
    for (const value of [...super.values()]) {
      this.delete(value);
    }
  }
}

/**
 * Creates an authenticated Azure header carrier without first appending a raw
 * credential to native Headers, where rejected values appear in diagnostics.
 */
export const buildAzureAuthenticationHeaders = (...headers: AzureAuthenticationValues): NullableHeaders => {
  const nulls = new DeferredAzureAuthenticationNulls();
  const carrier: NullableHeaders = {
    [brand_privateNullableHeaders]: true,
    values: new DeferredAzureAuthenticationHeaders(),
    nulls,
  };
  azureAuthenticationHeaders.set(carrier, headers);
  azureAuthenticationHeaderCarriers.set(carrier.values, carrier);
  azureAuthenticationNullCarriers.set(carrier.nulls, carrier);
  const records = new WeakMap<object, AzureAuthenticationRecordSnapshot>();
  azureAuthenticationHeaderRecordSnapshots.set(carrier, records);

  try {
    for (const layer of headers) {
      if (layer === undefined || layer === null) continue;
      if (brand_privateNullableHeaders in layer) {
        for (const name of ['api-key', 'authorization']) {
          if (Set.prototype.has.call(layer.nulls, name)) {
            nulls.seedInherited(name, true);
          } else if (Headers.prototype.has.call(layer.values, name)) {
            nulls.seedInherited(name, false);
          }
        }
        continue;
      }
      if (layer instanceof Headers) {
        for (const name of ['api-key', 'authorization']) {
          if (Headers.prototype.has.call(layer, name)) {
            nulls.seedInherited(name, false);
          }
        }
        continue;
      }
      if (isReadonlyArray(layer)) {
        for (const row of layer) {
          const name = row[0];
          if (typeof name !== 'string' || !isAzureAuthenticationHeader(name)) continue;
          const value = row[1];
          const values = isReadonlyArray(value) ? value : [value];
          for (const candidate of values) {
            if (candidate !== undefined) {
              nulls.seedInherited(name.toLowerCase(), candidate === null);
            }
          }
        }
        continue;
      }

      const descriptors = Object.getOwnPropertyDescriptors(layer);
      const keys = Object.keys(descriptors).filter((name) => descriptors[name]?.enumerable === true);
      records.set(layer, { descriptors, keys });
      for (const name of keys) {
        if (!isAzureAuthenticationHeader(name)) continue;
        const descriptor = descriptors[name];
        if (descriptor === undefined || !('value' in descriptor)) continue;
        const value: unknown = descriptor.value;
        const values = isReadonlyArray(value) ? value : [value];
        for (const candidate of values) {
          if (candidate !== undefined) {
            nulls.seedInherited(name.toLowerCase(), candidate === null);
          }
        }
      }
    }
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  return carrier;
};

/** Exposes already-safe effective credentials through genuine native Headers intrinsics. */
export const materializeAzureAuthenticationHeaders = (carrier: NullableHeaders): NullableHeaders => {
  const effective = new Map<string, string[] | undefined>();

  for (const layer of snapshotAzureAuthenticationHeaders(carrier) ?? []) {
    const seen = new Set<string>();
    for (const [name, value] of layer) {
      const normalized = name.toLowerCase();
      if (!isAzureAuthenticationHeader(normalized)) continue;
      if (!seen.has(normalized)) {
        effective.delete(normalized);
        seen.add(normalized);
      }
      if (value === null) {
        effective.delete(normalized);
        continue;
      }
      if (typeof value !== 'string') {
        effective.set(normalized, undefined);
        continue;
      }
      const previous = effective.get(normalized);
      if (effective.has(normalized) && previous === undefined) continue;
      effective.set(normalized, [...(previous ?? []), value]);
    }
  }

  let materialized = azureAuthenticationMaterializedHeaders.get(carrier.values);
  const unmaterialized = new Set<string>();
  for (const [name, values] of effective) {
    if (values === undefined) {
      unmaterialized.add(name);
      continue;
    }
    try {
      for (const value of values) {
        assertAzureCredentialHeaderValue(value);
      }
    } catch {
      // Malformed or shadowed credentials remain deferred so protected hooks may replace them.
      unmaterialized.add(name);
      continue;
    }

    Headers.prototype.delete.call(carrier.values, name);
    for (const value of values) {
      Headers.prototype.append.call(carrier.values, name, value);
    }
    materialized ??= new Set<string>();
    materialized.add(name);
  }
  if (materialized !== undefined) {
    azureAuthenticationMaterializedHeaders.set(carrier.values, materialized);
  }
  if (unmaterialized.size !== 0) {
    azureAuthenticationUnmaterializedHeaders.set(carrier.values, unmaterialized);
  }
  return carrier;
};

/** Privately protects one synchronous Azure body pass and its authenticated final merge. */
export const protectAzureRequestHeaders = (
  headers: HeadersLike,
  owner?: object,
): AzureRequestHeaderProtection | undefined => {
  if (headers === undefined || headers === null || typeof headers !== 'object') {
    return undefined;
  }

  let registrations = azureRequestHeaders.get(headers);
  if (!registrations) {
    registrations = {
      references: 0,
      markers: [],
      registrations: new Set(),
    };
    azureRequestHeaders.set(headers, registrations);
  }
  const activeRegistrations = registrations;
  const carrier = buildAzureAuthenticationHeaders(headers);
  const activeRegistration: AzureRequestHeaderRegistration = {
    carrier,
    headers,
    owner,
    record: azureAuthenticationHeaderRecordSnapshots.get(carrier)?.get(headers),
  };
  azureRequestAuthenticationHeaders.set(carrier, activeRegistration);
  activeRegistrations.references += 1;
  activeRegistrations.registrations.add(activeRegistration);
  const marker: AzureRequestHeaderMarker = {
    active: true,
    reserved: false,
    registration: activeRegistration,
  };
  activeRegistrations.markers.push(marker);
  let released = false;

  const deactivate = (): void => {
    if (!marker.active) return;
    marker.active = false;
    const position = activeRegistrations.markers.indexOf(marker);
    if (position !== -1) {
      activeRegistrations.markers.splice(position, 1);
    }
  };
  const release = (): void => {
    if (released) return;
    released = true;
    deactivate();
    activeRegistrations.registrations.delete(activeRegistration);
    activeRegistrations.references -= 1;
    if (activeRegistrations.references === 0) {
      azureRequestHeaders.delete(headers);
    }
  };

  const bind = (carrier: NullableHeaders): NullableHeaders => {
    const authentic = azureAuthenticationHeaders.has(carrier)
      ? carrier
      : azureAuthenticationHeaderCarriers.get(carrier.values);
    if (!authentic) {
      return carrier;
    }
    const isolated = { ...carrier };
    azureRequestAuthenticationHeaders.set(isolated, activeRegistration);
    return isolated;
  };

  return {
    bind,
    deactivate,
    release,
    snapshot: () => {
      if (
        overridesAzureAuthenticationHeader(headers, 'api-key', activeRegistration) ||
        overridesAzureAuthenticationHeader(headers, 'authorization', activeRegistration)
      ) {
        const effective = new Map<string, string[]>();
        for (const layer of snapshotAzureAuthenticationHeaders(
          activeRegistration.carrier,
          activeRegistration,
        ) ?? []) {
          for (const [name, value] of layer) {
            const normalized = name.toLowerCase();
            if (!isAzureAuthenticationHeader(normalized)) continue;
            if (value === null) {
              effective.delete(normalized);
              continue;
            }
            const current = effective.get(normalized);
            if (current === undefined) {
              effective.set(normalized, [value]);
            } else {
              current.push(value);
            }
          }
        }
        for (const values of effective.values()) {
          for (const value of values) {
            if (typeof value !== 'string') {
              coerceAzureCredentialHeaderValue(value);
            }
          }
        }
      }
    },
  };
};

/** Captures a request-local Azure header capability before asynchronous authentication starts. */
export const captureAzureHeaders = (
  client: object,
  options: FinalRequestOptions,
): AzureRequestHeaderSnapshot | undefined => {
  const active = azureRequestHeaderSnapshots.get(options);
  const context = active?.[active.length - 1];
  return context?.client === client ? context.snapshot : undefined;
};

/** Binds one synchronous request-build invocation without mutating its client or caller options. */
export const withAzureRequestHeaderSnapshot = <Result>(
  client: object,
  options: FinalRequestOptions,
  authenticationOptions: FinalRequestOptions,
  headers: () => HeadersLike,
  protection: AzureRequestHeaderProtection | undefined,
  build: () => Result,
): Result => {
  let active = azureRequestHeaderSnapshots.get(options);
  if (active === undefined) {
    active = [];
    azureRequestHeaderSnapshots.set(options, active);
  }
  const contexts = active;
  const snapshot: AzureRequestHeaderSnapshot = {
    authenticate: async (authentication, schemes) => {
      protection?.snapshot();
      const carrier = await Reflect.apply(authentication, client, [authenticationOptions, schemes]);
      return carrier === undefined || protection === undefined ? carrier : protection.bind(carrier);
    },
    headers,
  };
  contexts.push({ client, snapshot });
  try {
    return build();
  } finally {
    contexts.pop();
    if (contexts.length === 0) {
      azureRequestHeaderSnapshots.delete(options);
    }
  }
};

const reserveAzureBodyMarker = (headers: HeadersLike): AzureRequestHeaderMarker | undefined => {
  if (headers === undefined || headers === null || typeof headers !== 'object') return undefined;
  const markers = azureRequestHeaders.get(headers)?.markers;
  const marker = markers?.[markers.length - 1];
  if (marker === undefined || !marker.active || marker.reserved) return undefined;
  marker.reserved = true;
  return marker;
};

const matchesAzureRequestHeaders = (
  headers: HeadersLike,
  registration: AzureRequestHeaderRegistration,
): boolean => {
  if (headers === registration.headers) return true;
  if (registration.owner === undefined || typeof headers !== 'object' || headers === null) return false;
  const registrations = azureRequestHeaders.get(headers);
  if (registrations === undefined) return false;
  for (const candidate of registrations.registrations) {
    if (candidate.owner === registration.owner) return true;
  }
  return false;
};

function* iterateHeaderRecord(
  headers: Record<string, HeaderValue | readonly HeaderValue[]>,
  record?: AzureAuthenticationRecordSnapshot,
): IterableIterator<readonly [string, HeaderValue | readonly HeaderValue[]]> {
  for (const name of record?.keys ?? Object.keys(headers)) {
    let value: HeaderValue | readonly HeaderValue[];
    try {
      value = headers[name];
    } catch (error) {
      if (isAzureAuthenticationHeader(name)) {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      throw error;
    }
    yield [name, value];
  }
}

function* iterateHeaders(
  headers: HeadersLike,
  registration?: AzureRequestHeaderRegistration,
  record?: AzureAuthenticationRecordSnapshot,
): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    const nullNames = new Set([...nulls].map((name) => name.toLowerCase()));
    const deferredValues = azureAuthenticationHeaderCarriers.has(values);
    const keys = deferredValues ? Headers.prototype.keys.call(values) : values.keys();
    const visibleNames = new Set([...keys, ...nullNames].map((name) => name.toLowerCase()));
    const mutations = azureAuthenticationHeaderMutations.get(values);
    const materialized = azureAuthenticationMaterializedHeaders.get(values);
    const nativeMutationValues = azureAuthenticationMutationNativeValues.get(values);
    const carrier = azureAuthenticationHeaderCarriers.get(values) ?? headers;
    const activeRegistration = registration ?? azureRequestAuthenticationHeaders.get(carrier);
    const sources = azureAuthenticationHeaders.get(carrier);
    const layers = snapshotAzureAuthenticationHeaders(carrier, activeRegistration);
    if (layers !== undefined) {
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        if (layer === undefined) continue;
        const seen = new Set<string>();
        const refreshed = new Set<string>();
        for (const [name, snapshot] of layer) {
          const normalized = name.toLowerCase();
          const mutation = mutations?.get(normalized);
          if (
            nullNames.has(normalized) ||
            materialized?.has(normalized) ||
            mutation?.kind === 'delete' ||
            mutation?.kind === 'replace' ||
            (visibleNames.has(normalized) && mutation?.kind !== 'append')
          ) {
            continue;
          }
          if (!seen.has(normalized)) {
            seen.add(normalized);
            yield [name, null];
          }
          if (
            !isAzureAuthenticationHeader(normalized) &&
            activeRegistration?.record !== undefined &&
            sources?.[index] === activeRegistration.headers
          ) {
            if (refreshed.has(name)) continue;
            refreshed.add(name);
            const current = (
              activeRegistration.headers as Record<string, HeaderValue | readonly HeaderValue[]>
            )[name];
            if (current === undefined) continue;
            yield [name, null];
            const currentValues = isReadonlyArray(current) ? current : [current];
            for (const value of currentValues) {
              if (value !== undefined) yield [name, value];
            }
            continue;
          }
          yield [name, snapshot];
        }
      }
    }
    const emitted = new Set<string>();
    const entries = deferredValues ? Headers.prototype.entries.call(values) : values.entries();
    for (const [name, value] of entries) {
      const normalized = name.toLowerCase();
      const mutation = mutations?.get(normalized);
      if (mutation === undefined && azureAuthenticationUnmaterializedHeaders.get(values)?.has(normalized)) {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      if (mutation && isAzureAuthenticationHeader(normalized)) {
        emitted.add(normalized);
        if (materialized?.has(normalized)) {
          yield [name, value];
          if (nativeMutationValues?.get(normalized) === value) {
            for (const pending of mutation.values) {
              try {
                assertAzureCredentialHeaderValue(pending);
              } catch {
                yield [name, pending];
              }
            }
          }
        } else {
          for (const pending of mutation.values) {
            yield [name, pending];
          }
        }
      } else {
        yield [name, value];
      }
    }
    if (mutations) {
      for (const [name, mutation] of mutations) {
        if (!isAzureAuthenticationHeader(name) || emitted.has(name)) continue;
        if (
          materialized?.has(name) &&
          nativeMutationValues?.get(name) !== Headers.prototype.get.call(values, name)
        ) {
          continue;
        }
        for (const pending of mutation.values) {
          yield [name, pending];
        }
      }
    }
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  let shouldClear = false;
  let iter: Iterable<readonly (HeaderValue | readonly HeaderValue[])[]>;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = iterateHeaderRecord(
      headers as Record<string, HeaderValue | readonly HeaderValue[]>,
      record ?? (registration?.headers === headers ? registration.record : undefined),
    );
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === undefined) continue;

      // Objects keys always overwrite older headers, they never append.
      // Yield a null to clear the header before adding the new values.
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}

/** Validates only the final authentication values without native construction. */
export const assertAzureAuthenticationHeaders = (headers: HeadersLike): void => {
  for (const [name, value] of iterateHeaders(headers)) {
    if (value !== null && isAzureAuthenticationHeader(name)) {
      assertAzureCredentialHeaderValue(coerceAzureCredentialHeaderValue(value));
    }
  }
};

const assertNoUnboundAzureRequestRegistration = (headers: HeadersLike[]): void => {
  for (const source of headers) {
    if (source !== null && typeof source === 'object' && azureRequestHeaders.has(source)) {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  }
};

const overridesAzureAuthenticationRecordValue = (
  headers: object,
  key: string,
  record?: AzureAuthenticationRecordSnapshot,
): boolean => {
  const descriptor = record?.descriptors[key] ?? Object.getOwnPropertyDescriptor(headers, key);
  if (descriptor === undefined) {
    return false;
  }
  if (!('value' in descriptor)) {
    return true;
  }
  const value: unknown = descriptor.value;
  return Array.isArray(value) ? value.some((candidate) => candidate !== undefined) : value !== undefined;
};

const azureAuthenticationTupleValueDescriptor = (
  value: object,
  index: number,
): PropertyDescriptor | undefined => {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, index);
    if (descriptor !== undefined) return descriptor;
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  if (owner !== null) {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  return undefined;
};

const overridesAzureAuthenticationHeader = (
  headers: HeadersLike,
  name: string,
  registration?: AzureRequestHeaderRegistration,
  record?: AzureAuthenticationRecordSnapshot,
): boolean => {
  if (headers === undefined || headers === null || typeof headers !== 'object') {
    return false;
  }

  if (brand_privateNullableHeaders in headers) {
    const carrier = azureAuthenticationHeaders.has(headers as NullableHeaders)
      ? (headers as NullableHeaders)
      : azureAuthenticationHeaderCarriers.get((headers as NullableHeaders).values);
    if (carrier !== undefined) {
      const activeRegistration = registration ?? azureRequestAuthenticationHeaders.get(carrier);
      const records = azureAuthenticationHeaderRecordSnapshots.get(carrier);
      const mutations = azureAuthenticationHeaderMutations.get(carrier.values);
      const mutation = mutations?.get(name);
      const materialized = azureAuthenticationMaterializedHeaders.get(carrier.values)?.has(name);
      if (
        materialized &&
        mutation !== undefined &&
        azureAuthenticationMutationNativeValues.get(carrier.values)?.get(name) !==
          Headers.prototype.get.call(carrier.values, name)
      ) {
        return (
          Set.prototype.has.call((headers as NullableHeaders).nulls, name) ||
          Headers.prototype.has.call((headers as NullableHeaders).values, name)
        );
      }
      if (mutation?.kind === 'replace' || mutation?.kind === 'append') {
        return true;
      }
      if (mutation?.kind === 'delete') {
        return false;
      }
      if (materialized) {
        return (
          Set.prototype.has.call((headers as NullableHeaders).nulls, name) ||
          Headers.prototype.has.call((headers as NullableHeaders).values, name)
        );
      }
      for (const layer of azureAuthenticationHeaders.get(carrier) ?? []) {
        if (
          overridesAzureAuthenticationHeader(
            layer,
            name,
            activeRegistration,
            layer !== null && typeof layer === 'object' ? records?.get(layer) : undefined,
          )
        ) {
          return true;
        }
      }
    }
    return (
      Set.prototype.has.call((headers as NullableHeaders).nulls, name) ||
      Headers.prototype.has.call((headers as NullableHeaders).values, name)
    );
  }

  if (headers instanceof Headers) {
    return Headers.prototype.has.call(headers, name);
  }

  if (isReadonlyArray(headers)) {
    try {
      return headers.some((entry) => {
        const candidate = entry[0];
        if (typeof candidate !== 'string' || candidate.toLowerCase() !== name) {
          return false;
        }

        const descriptor = azureAuthenticationTupleValueDescriptor(entry, 1);
        if (descriptor === undefined) {
          return false;
        }
        if (!('value' in descriptor)) {
          return true;
        }

        const value: unknown = descriptor.value;
        if (!isReadonlyArray(value)) {
          return value !== undefined;
        }
        for (let index = 0; index < value.length; index += 1) {
          const element = azureAuthenticationTupleValueDescriptor(value, index);
          if (element !== undefined && (!('value' in element) || element.value !== undefined)) {
            return true;
          }
        }
        return false;
      });
    } catch {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  }

  const snapshot = record ?? (registration?.headers === headers ? registration.record : undefined);
  try {
    for (const key of snapshot?.keys ?? Object.keys(headers)) {
      if (key.toLowerCase() === name && overridesAzureAuthenticationRecordValue(headers, key, snapshot)) {
        return true;
      }
    }
  } catch {
    throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
  }
  return false;
};

const hasRemainingAzureAuthenticationOverride = (
  headers: HeadersLike,
  current: string,
  name: string,
  registration?: AzureRequestHeaderRegistration,
  record?: AzureAuthenticationRecordSnapshot,
): boolean => {
  if (
    headers === undefined ||
    headers === null ||
    typeof headers !== 'object' ||
    brand_privateNullableHeaders in headers ||
    headers instanceof Headers ||
    isReadonlyArray(headers)
  ) {
    return false;
  }

  let found = false;
  const snapshot = record ?? (registration?.headers === headers ? registration.record : undefined);
  for (const key of snapshot?.keys ?? Object.keys(headers)) {
    if (!found) {
      found = key === current;
      continue;
    }
    if (key.toLowerCase() === name && overridesAzureAuthenticationRecordValue(headers, key, snapshot)) {
      return true;
    }
  }
  return false;
};

const hasLaterAzureAuthenticationOverride = (
  sources: HeadersLike[],
  index: number,
  name: string,
  registration?: AzureRequestHeaderRegistration,
): boolean => {
  for (let candidate = index + 1; candidate < sources.length; candidate += 1) {
    if (overridesAzureAuthenticationHeader(sources[candidate], name, registration)) {
      return true;
    }
  }
  return false;
};

const buildHeadersWithRegistration = (
  newHeaders: HeadersLike[],
  bodyRegistration: AzureRequestHeaderRegistration | undefined,
): NullableHeaders => {
  let requestRegistration = bodyRegistration;
  let protectsAzureCredentials = bodyRegistration !== undefined;
  if (!protectsAzureCredentials) {
    for (const headers of newHeaders) {
      if (typeof headers !== 'object' || headers === null) {
        continue;
      }
      const carrier = azureAuthenticationHeaders.has(headers as NullableHeaders)
        ? (headers as NullableHeaders)
        : brand_privateNullableHeaders in headers
          ? azureAuthenticationHeaderCarriers.get((headers as NullableHeaders).values)
          : undefined;
      if (!carrier) {
        continue;
      }
      protectsAzureCredentials = true;
      requestRegistration =
        azureRequestAuthenticationHeaders.get(headers as NullableHeaders) ??
        azureRequestAuthenticationHeaders.get(carrier);
      if (requestRegistration) {
        break;
      }
    }
    if (protectsAzureCredentials && requestRegistration === undefined) {
      assertNoUnboundAzureRequestRegistration(newHeaders);
    }
  }
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  const pendingAuthenticationHeaders = new Map<string, string[]>();

  for (let sourceIndex = 0; sourceIndex < newHeaders.length; sourceIndex += 1) {
    const source = newHeaders[sourceIndex];
    const seenHeaders = new Set<string>();
    const headers =
      protectsAzureCredentials &&
      requestRegistration !== undefined &&
      matchesAzureRequestHeaders(source, requestRegistration)
        ? requestRegistration.carrier
        : source;
    const unprovenAuthenticationHeaders = new Map<string, string[]>();
    for (const [name, values] of pendingAuthenticationHeaders) {
      const mutable = values.filter((value) => typeof value !== 'string');
      if (mutable.length > 0 && overridesAzureAuthenticationHeader(headers, name, requestRegistration)) {
        unprovenAuthenticationHeaders.set(name, mutable);
      }
    }
    if (requestRegistration !== undefined && headers === requestRegistration.carrier) {
      snapshotAzureAuthenticationHeaders(headers, requestRegistration);
    }
    for (const [name, value] of iterateHeaders(headers, requestRegistration)) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      const deferAuthenticationHeader = protectsAzureCredentials && isAzureAuthenticationHeader(lowerName);
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(lowerName);
        if (deferAuthenticationHeader) {
          pendingAuthenticationHeaders.delete(lowerName);
        }
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(lowerName);
        if (deferAuthenticationHeader) {
          pendingAuthenticationHeaders.delete(lowerName);
        }
        nullHeaders.add(lowerName);
      } else {
        if (deferAuthenticationHeader) {
          let snapshot = value;
          if (typeof value !== 'string') {
            const shadowedHere = hasRemainingAzureAuthenticationOverride(
              headers === requestRegistration?.carrier ? source : headers,
              name,
              lowerName,
              requestRegistration,
            );
            if (shadowedHere) {
              const uncertain = unprovenAuthenticationHeaders.get(lowerName) ?? [];
              uncertain.push(value);
              unprovenAuthenticationHeaders.set(lowerName, uncertain);
            }
            if (
              !shadowedHere &&
              !hasLaterAzureAuthenticationOverride(newHeaders, sourceIndex, lowerName, requestRegistration)
            ) {
              snapshot = coerceAzureCredentialHeaderValue(value);
            }
          }
          const pending = pendingAuthenticationHeaders.get(lowerName);
          if (pending) {
            pending.push(snapshot);
          } else {
            pendingAuthenticationHeaders.set(lowerName, [snapshot]);
          }
        } else {
          targetHeaders.append(lowerName, value);
        }
        nullHeaders.delete(lowerName);
      }
    }
    for (const [name, uncertain] of unprovenAuthenticationHeaders) {
      if (pendingAuthenticationHeaders.get(name)?.some((value) => uncertain.includes(value))) {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
    }
  }
  for (const [name, values] of pendingAuthenticationHeaders) {
    const snapshots = values.map((value) => {
      const snapshot = coerceAzureCredentialHeaderValue(value);
      assertAzureCredentialHeaderValue(snapshot);
      return snapshot;
    });
    pendingAuthenticationHeaders.set(name, snapshots);
  }
  for (const [name, values] of pendingAuthenticationHeaders) {
    for (const value of values) {
      targetHeaders.append(name, value);
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders => {
  const marker = newHeaders.length === 1 ? reserveAzureBodyMarker(newHeaders[0]) : undefined;
  try {
    return buildHeadersWithRegistration(newHeaders, marker?.registration);
  } finally {
    if (marker !== undefined) {
      marker.reserved = false;
    }
  }
};

export const isEmptyHeaders = (headers: HeadersLike) => {
  for (const _ of iterateHeaders(headers)) return false;
  return true;
};
