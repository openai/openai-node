import { getPlatformHeader, getVerifiedPlatformHeader } from './platform-headers';
import {
  HeaderReplay,
  iterateHeaderEntries,
  getArrayIterator,
  hasStatefulArrayProperties,
  hasNativeHeadersBrand,
  type HeaderValue,
  type HeaderReplayCallbacks,
} from './header-replay';
export { hasNativeHeadersBrand } from './header-replay';
export { getPlatformHeader } from './platform-headers';
import {
  copyWorkloadHeaderCredential,
  rememberWorkloadHeaderCredential,
  rememberWorkloadHeaderValues,
  workloadHeaderCredential,
} from './auth/workload-token-provenance';

export type HeadersLike =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>
  | undefined
  | null
  | NullableHeaders;

const brand_privateNullableHeaders = /* @__PURE__ */ Symbol('brand.privateNullableHeaders');
const httpTokenHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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

/** Checks retryable hook inputs without invoking their iterable protocol or value getters. */
export const canReplayHeaderInput = (headers: HeadersLike, inputs = new Set<object>()): boolean => {
  if (!headers) return true;
  if (inputs.has(headers)) return false;
  inputs.add(headers);
  try {
    if (brand_privateNullableHeaders in headers) return true;
    let descriptor: PropertyDescriptor | undefined;
    const seen = new Set<object>();
    for (let prototype: object | null = headers; prototype; prototype = Object.getPrototypeOf(prototype)) {
      if (seen.has(prototype)) return false;
      seen.add(prototype);
      descriptor = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      if (descriptor) break;
    }
    if (descriptor) {
      if (typeof descriptor.value !== 'function') return false;
      if (Array.isArray(headers)) {
        if (descriptor.value !== getArrayIterator(headers) || hasStatefulArrayProperties(headers))
          return false;
        const length = Object.getOwnPropertyDescriptor(headers, 'length')?.value;
        for (let index = 0; index < length; index += 1) {
          // A missing own descriptor cannot distinguish an ordinary hole from a Proxy-supplied value.
          // Without a consumed snapshot, retrying it would read caller state a second time.
          if (!Object.getOwnPropertyDescriptor(headers, String(index))) return false;
        }
      } else {
        return getVerifiedPlatformHeader(headers, 'authorization') !== undefined;
      }
    }
    return Object.entries(Object.getOwnPropertyDescriptors(headers)).every(([key, property]) => {
      if (Array.isArray(headers) ? !/^(0|[1-9]\d*)$/.test(key) : !property.enumerable) return true;
      if (!('value' in property)) return false;
      return Array.isArray(property.value)
        ? canReplayHeaderInput(property.value, inputs)
        : property.value === null ||
            (typeof property.value !== 'object' && typeof property.value !== 'function');
    });
  } catch {
    return false;
  } finally {
    inputs.delete(headers);
  }
};

/** Unknown iterable implementations must dispatch the same snapshot used for credential attribution. */
export const canPreserveHeaderInput = (headers: HeadersLike): boolean => {
  if (!headers) return true;
  try {
    if (!Array.isArray(headers) && Symbol.iterator in headers) {
      return hasNativeHeadersBrand(headers) && getPlatformHeader(headers, 'Authorization') !== undefined;
    }
    return canReplayHeaderInput(headers);
  } catch {
    return false;
  }
};

/** Reads only data descriptors, so unrelated structural header values remain untouched until dispatch. */
export const getStructuralHeaderValue = (
  headers: HeadersLike,
  requestedName: string,
): { value: string | null } | undefined => {
  if (!headers) return { value: null };
  try {
    if (brand_privateNullableHeaders in headers || (!Array.isArray(headers) && Symbol.iterator in headers)) {
      return undefined;
    }
    const requested = requestedName.toLowerCase();
    const entries: [string, HeaderValue][] = [];
    let unknown = false;
    const copyInput = (input: unknown): { value: HeaderValue } | undefined => {
      if (typeof input === 'string') return { value: input };
      if (input === null) return { value: null };
      if (input === undefined) return { value: undefined };
      return undefined;
    };
    const hasNativeIterator = (input: readonly unknown[]): boolean => {
      try {
        let descriptor: PropertyDescriptor | undefined;
        const seen = new Set<object>();
        for (let source: object | null = input; source; source = Object.getPrototypeOf(source)) {
          if (seen.has(source)) return false;
          seen.add(source);
          descriptor = Object.getOwnPropertyDescriptor(source, Symbol.iterator);
          if (descriptor) break;
        }
        return !!descriptor && 'value' in descriptor && descriptor.value === getArrayIterator(input);
      } catch {
        return false;
      }
    };
    if (Array.isArray(headers)) {
      if (!hasNativeIterator(headers)) return undefined;
      const length = Object.getOwnPropertyDescriptor(headers, 'length')?.value;
      if (typeof length !== 'number') return undefined;
      for (let index = 0; index < length; index += 1) {
        try {
          const rowDescriptor = Object.getOwnPropertyDescriptor(headers, String(index));
          if (
            !rowDescriptor ||
            !('value' in rowDescriptor) ||
            !Array.isArray(rowDescriptor.value) ||
            !hasNativeIterator(rowDescriptor.value)
          ) {
            unknown = true;
            continue;
          }
          const nameDescriptor = Object.getOwnPropertyDescriptor(rowDescriptor.value, '0');
          const valueDescriptor = Object.getOwnPropertyDescriptor(rowDescriptor.value, '1');
          if (!nameDescriptor || !('value' in nameDescriptor) || typeof nameDescriptor.value !== 'string') {
            unknown = true;
            continue;
          }
          if (nameDescriptor.value.toLowerCase() !== requested) continue;
          if (!valueDescriptor || !('value' in valueDescriptor)) {
            unknown = true;
            continue;
          }
          const input = copyInput(valueDescriptor.value);
          if (!input) {
            unknown = true;
            continue;
          }
          entries.push([nameDescriptor.value, input.value]);
        } catch {
          unknown = true;
        }
      }
    } else {
      for (const key of Reflect.ownKeys(headers)) {
        if (typeof key !== 'string' || key.toLowerCase() !== requested) continue;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(headers, key);
          if (!descriptor || !('value' in descriptor)) {
            unknown = true;
            continue;
          }
          const input = copyInput(descriptor.value);
          if (!input) {
            unknown = true;
            continue;
          }
          entries.push([key, input.value]);
        } catch {
          unknown = true;
        }
      }
    }
    if (unknown && entries.length === 0) return undefined;
    return {
      value: new Headers(entries as unknown as [string, string][]).get(requestedName),
    };
  } catch {
    return undefined;
  }
};

function* iterateHeaders(
  headers: HeadersLike,
  replay?: HeaderReplay,
  provenance?: { unknown: boolean; values?: Headers },
  capture: HeaderReplayCallbacks['capture'] = (name) => [name, null],
  layer?: HeaderReplayCallbacks['layer'],
): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    if (provenance) provenance.unknown = true;
    const { values, nulls } = headers;
    if (provenance) provenance.values = values;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }

  const callbacks: HeaderReplayCallbacks = {
    layer,
    normalize: (name, value) => new Headers([[name, value]]).get(name)!,
    capture,
    previous: (snapshot) => iterateHeaders(snapshot, undefined, provenance),
    ...(provenance
      ? {
          onIterator: (native: boolean) => {
            provenance.unknown = native;
          },
        }
      : {}),
  };
  yield* replay ? replay.entries(headers, callbacks) : iterateHeaderEntries(headers, callbacks);
}

const mergeHeaderEntries = (
  newHeaders: {
    source: HeadersLike;
    provenance: { unknown: boolean; values?: Headers };
    replay?: HeaderReplay;
    layer?: HeaderReplayCallbacks['layer'];
  }[],
): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  let credential: ReturnType<typeof workloadHeaderCredential>;
  let hasAuthorizationLayer = false;
  for (const { source, provenance, replay, layer } of newHeaders) {
    const seenHeaders = new Set<string>();
    let suppliesAuthorization = false;
    const entries = iterateHeaders(
      source,
      replay,
      provenance,
      (name) => {
        const lowerName = name.toLowerCase();
        const value = targetHeaders.get(lowerName);
        return [
          name,
          value !== null && lowerName === 'set-cookie'
            ? [...targetHeaders.entries()].filter(([key]) => key === lowerName).map(([, entry]) => entry)
            : value,
        ];
      },
      layer,
    );
    for (const [name, value] of entries) {
      if (!httpTokenHeaderName.test(name)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
      }
      const lowerName = name.toLowerCase();
      if (lowerName === 'authorization') {
        suppliesAuthorization = true;
        const credentialSource = provenance.values ?? source;
        const sourceCredential = credentialSource ? workloadHeaderCredential(credentialSource) : undefined;
        // Native copies lose metadata; raw record/tuple layers explicitly supply independent credentials.
        credential =
          sourceCredential !== undefined
            ? sourceCredential
            : provenance.unknown
              ? hasAuthorizationLayer
                ? null
                : undefined
              : null;
      }
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(lowerName);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(lowerName);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(lowerName, value);
        nullHeaders.delete(lowerName);
      }
    }
    hasAuthorizationLayer ||= suppliesAuthorization;
  }
  const result = { [brand_privateNullableHeaders]: true as const, values: targetHeaders, nulls: nullHeaders };
  if (credential !== undefined) {
    const copiedCredential = copyWorkloadHeaderCredential(credential);
    rememberWorkloadHeaderCredential(result, copiedCredential, targetHeaders);
    rememberWorkloadHeaderValues(targetHeaders, copiedCredential);
  }
  return result;
};

interface HeaderReadContext {
  captured: WeakMap<object, NullableHeaders>;
  preferred: WeakMap<object, NullableHeaders>;
  onRead?: ((source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void) | undefined;
}

let headerReadContext: HeaderReadContext | undefined;
const capturedHeaderReplays = new WeakMap<NullableHeaders, { source: HeadersLike; replay: HeaderReplay }>();

/** Captures synchronous protected-hook reads without leaving request state ambient across an await. */
export function captureHeaderReads<T>(
  operation: () => T,
  preferred: { source: HeadersLike; snapshot: NullableHeaders }[] = [],
  onRead?: (source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void,
): { result: T; captured: WeakMap<object, NullableHeaders> } {
  const previous = headerReadContext;
  const context: HeaderReadContext = { captured: new WeakMap(), preferred: new WeakMap(), onRead };
  for (const { source, snapshot } of preferred) {
    if (typeof source === 'object' && source !== null) context.preferred.set(source, snapshot);
  }
  headerReadContext = context;
  try {
    return { result: operation(), captured: context.captured };
  } finally {
    headerReadContext = previous;
  }
}

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders => {
  const context = headerReadContext;
  const result = mergeHeaderEntries(
    newHeaders.map((originalSource) => {
      const source =
        typeof originalSource === 'object' && originalSource !== null
          ? (context?.preferred.get(originalSource) ?? originalSource)
          : originalSource;
      const provenance = { unknown: false };
      const replay = context && source === originalSource ? new HeaderReplay() : undefined;
      const capturedReplay =
        replay ??
        (source && brand_privateNullableHeaders in source
          ? capturedHeaderReplays.get(source)?.replay
          : undefined);
      const entry = {
        source,
        provenance,
        ...(replay ? { replay } : {}),
      };
      if (!context || typeof originalSource !== 'object' || originalSource === null) return entry;

      // Capture each raw layer separately; merged hook headers cannot seed one source's snapshot.
      const snapshot = mergeHeaderEntries([entry]);
      context.captured.set(originalSource, snapshot);
      if (capturedReplay) {
        capturedHeaderReplays.set(snapshot, {
          source: originalSource,
          replay: capturedReplay.fork(),
        });
      }
      context.onRead?.(originalSource, snapshot);
      return { source: snapshot, provenance: { unknown: true } };
    }),
  );
  return result;
};

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export interface HeaderSnapshot {
  readonly source: HeadersLike;
  readonly snapshot: NullableHeaders;
  readonly refreshable: boolean;
  readonly replayable: boolean;
  readonly initialized: boolean;
  refresh: (...sources: [] | [HeadersLike]) => NullableHeaders;
  seed: (source: HeadersLike, snapshot: NullableHeaders | undefined) => void;
  fork: (layer?: HeaderReplayCallbacks['layer']) => HeaderSnapshot;
}

const createHeaderSnapshot = (
  initialSource: HeadersLike,
  initial?: {
    snapshot?: NullableHeaders;
    refreshable?: boolean;
    deferred?: boolean;
    replay?: HeaderReplay;
    materialization?: { source: HeadersLike; snapshot?: NullableHeaders };
    layer?: HeaderReplayCallbacks['layer'];
  },
): HeaderSnapshot => {
  let source = initialSource;
  const layer = initial?.layer;
  // Forks share only their first materialization; source replacement and replay state stay layer-local.
  const materialization = initial?.materialization ?? { source: initialSource };
  const captured = initial?.snapshot ? capturedHeaderReplays.get(initial.snapshot) : undefined;
  let replay: HeaderReplay =
    initial?.replay ??
    (captured && captured.source === source
      ? captured.replay.fork()
      : new HeaderReplay(initial?.refreshable ?? true));
  let snapshot = initial?.snapshot;
  const inheritMaterialization = () => {
    if (!snapshot && source === materialization.source && materialization.snapshot) {
      snapshot = materialization.snapshot;
      const metadata = capturedHeaderReplays.get(snapshot);
      replay = metadata ? metadata.replay.fork() : new HeaderReplay(false);
    }
  };
  const rememberMaterialization = () => {
    if (snapshot && source === materialization.source && !materialization.snapshot) {
      materialization.snapshot = snapshot;
    }
  };
  const initialize = () => {
    inheritMaterialization();
    if (snapshot) return snapshot;
    const provenance = { unknown: false };
    snapshot = mergeHeaderEntries([{ source, provenance, replay, layer }]);
    capturedHeaderReplays.set(snapshot, { source, replay: replay.fork() });
    rememberMaterialization();
    return snapshot;
  };
  if (!initial?.deferred) initialize();
  return {
    get source() {
      return source;
    },
    get snapshot() {
      return initialize();
    },
    get refreshable() {
      return replay.refreshable;
    },
    get initialized() {
      return snapshot !== undefined;
    },
    get replayable() {
      return replay.replayable;
    },
    refresh: (...sources: [] | [HeadersLike]) => {
      inheritMaterialization();
      const currentSource = sources.length === 0 ? source : sources[0];
      if (snapshot && currentSource === snapshot) return snapshot;
      if (!snapshot || currentSource !== source || replay.refreshable) {
        const priorSnapshot = snapshot;
        const nextReplay = currentSource === source ? replay.next(priorSnapshot) : new HeaderReplay();
        const nextProvenance = { unknown: false };
        let nextSnapshot = mergeHeaderEntries([
          {
            source: currentSource,
            provenance: nextProvenance,
            replay: nextReplay,
            layer,
          },
        ]);
        if (
          currentSource === source &&
          nextReplay.unverifiedHeaders &&
          priorSnapshot &&
          [...priorSnapshot.values.keys(), ...priorSnapshot.nulls].some(
            (name) => !nextSnapshot.values.has(name) && !nextSnapshot.nulls.has(name),
          )
        ) {
          // Missing foreign rows are ambiguous, but newly observed rows remain authoritative.
          nextSnapshot = buildHeaders([priorSnapshot, nextSnapshot]);
        }
        source = currentSource;
        replay = nextReplay;
        snapshot = nextSnapshot;
        capturedHeaderReplays.set(snapshot, { source, replay: replay.fork() });
        rememberMaterialization();
      }
      return initialize();
    },
    seed: (currentSource, captured) => {
      if (!snapshot && currentSource === source && captured) {
        snapshot = captured;
        const metadata = capturedHeaderReplays.get(captured);
        replay = metadata && metadata.source === source ? metadata.replay.fork() : new HeaderReplay(false);
        rememberMaterialization();
      }
    },
    fork: (forkLayer = layer) =>
      createHeaderSnapshot(source, {
        ...(snapshot ? { snapshot } : {}),
        deferred: !snapshot,
        replay: replay.fork(),
        materialization,
        layer: forkLayer,
      }),
  };
};

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export const snapshotHeaders = (
  initialSource: HeadersLike,
  layer?: HeaderReplayCallbacks['layer'],
): HeaderSnapshot => createHeaderSnapshot(initialSource, { layer });

/** Parsed header layers shared by preparation and automatic retries. */
export interface WorkloadHeaderSnapshots {
  requestHeaders: ReturnType<typeof snapshotHeaders>;
  defaultHeaders: ReturnType<typeof snapshotHeaders>;
  customBuildInput?: {
    source: HeadersLike;
    defaultSource: HeadersLike;
    replayable: boolean;
    defaultReplayable: boolean;
    owned: boolean;
    independentAuthorization: boolean;
    preventCredentialUpgrade: boolean;
  };
}

/** Materializes each source once within one request, without sharing credentials between requests. */
export function createWorkloadHeaderSnapshots(
  request: HeadersLike,
  defaults: HeadersLike,
  {
    captured,
    deferRequest = false,
    deferDefault = false,
  }: {
    captured?: WeakMap<object, NullableHeaders>;
    deferRequest?: boolean;
    deferDefault?: boolean;
  } = {},
): WorkloadHeaderSnapshots {
  const capturedSnapshot = (source: HeadersLike) =>
    typeof source === 'object' && source !== null ? captured?.get(source) : undefined;
  const capturedDefault = capturedSnapshot(defaults);
  const defaultHeaders = createHeaderSnapshot(defaults, {
    layer: 'default',
    ...(capturedDefault ? { snapshot: capturedDefault } : {}),
    refreshable: false,
    deferred: deferDefault && !capturedDefault,
  });
  const capturedRequest = capturedSnapshot(request);
  return {
    defaultHeaders,
    requestHeaders:
      request === defaults
        ? defaultHeaders.fork('request')
        : createHeaderSnapshot(request, {
            layer: 'request',
            ...(capturedRequest ? { snapshot: capturedRequest } : {}),
            refreshable: false,
            deferred: deferRequest && !capturedRequest,
          }),
  };
}

export const isEmptyHeaders = (headers: HeadersLike) => {
  for (const _ of iterateHeaders(headers)) return false;
  return true;
};

/** Reads Request internal headers through its defining getter, bypassing caller property shadows. */
export const getRequestHeaders = (request: unknown): Headers | undefined => {
  if (typeof request !== 'object' || request === null) return undefined;
  try {
    if (typeof Request !== 'undefined' && request instanceof Request) {
      return Object.getOwnPropertyDescriptor(Request.prototype, 'headers')?.get?.call(request);
    }
    let getter: PropertyDescriptor['get'];
    const seen = new Set<object>();
    for (
      let prototype = Object.getPrototypeOf(request);
      prototype;
      prototype = Object.getPrototypeOf(prototype)
    ) {
      if (seen.has(prototype)) return undefined;
      seen.add(prototype);
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
      if (
        typeof constructor === 'function' &&
        Object.getOwnPropertyDescriptor(constructor, 'name')?.value === 'Request' &&
        Object.getOwnPropertyDescriptor(constructor, 'prototype')?.value === prototype &&
        Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)?.value === 'Request'
      ) {
        // A subclass can repeat the platform's name and tag. Select the defining getter before reading.
        getter = Object.getOwnPropertyDescriptor(prototype, 'headers')?.get ?? getter;
      }
    }
    return getter?.call(request);
  } catch {
    // A Request-shaped proxy can pass instanceof without satisfying the platform's internal brand.
  }
  return undefined;
};
