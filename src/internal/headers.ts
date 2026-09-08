import type { HeadersInit } from './builtin-types';
import { hasNativeHeadersBrand } from './platform-headers';
export { getPlatformHeader, hasNativeHeadersBrand } from './platform-headers';
import {
  copyWorkloadHeaderCredential,
  notifyWorkloadHeaderConsumption,
  observesWorkloadHeaderConsumption,
  rememberWorkloadHeaderCredential,
  rememberWorkloadHeaderValues,
  workloadHeaderCredential,
} from './auth/workload-token-provenance';

import {
  brand_privateNullableHeaders,
  canPreserveHeaderInput,
  copyHeaderReplay,
  iterateHeaders,
  HeaderReplay,
  type HeadersLike,
  type NullableHeaders,
} from './header-replay';
export { canReplayHeaderInput, canPreserveHeaderInput } from './header-replay';
export type { HeadersLike, NullableHeaders } from './header-replay';

const httpTokenHeaderName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const mergeHeaderEntries = (
  newHeaders: {
    source: HeadersLike;
    entries: Iterable<readonly [string, string | null]>;
    provenance: { unknown: boolean; values?: Headers };
    replay?: HeaderReplay;
  }[],
): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  let credential: ReturnType<typeof workloadHeaderCredential>;
  let hasAuthorizationLayer = false;
  for (const { source, entries, provenance, replay } of newHeaders) {
    const seenHeaders = new Set<string>();
    let suppliesAuthorization = false;
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
      if (replay?.property) {
        const property = replay.property;
        // Capture once after the property finishes, preserving platform normalization without rescanning
        // an expanding Set-Cookie collection after every append.
        property.capture ??= () => {
          const value = targetHeaders.get(lowerName);
          property.slot.value = [
            name,
            value !== null && lowerName === 'set-cookie'
              ? [...targetHeaders.entries()].filter(([key]) => key === lowerName).map(([, entry]) => entry)
              : value,
          ];
        };
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
  preferred: WeakMap<object, () => NullableHeaders>;
  onRead?: ((source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void) | undefined;
  onConsume?: ((source: object) => void) | undefined;
}

let headerReadContext: HeaderReadContext | undefined;
const capturedHeaderReplays = new WeakMap<NullableHeaders, { source: HeadersLike; replay: HeaderReplay }>();

/** Captures synchronous protected-hook reads without leaving request state ambient across an await. */
export function captureHeaderReads<T>(
  operation: () => T,
  preferred: HeaderSnapshot[] = [],
  onRead?: (source: NonNullable<HeadersLike>, snapshot: NullableHeaders) => void,
  onConsume?: (source: object) => void,
): { result: T; captured: WeakMap<object, NullableHeaders> } {
  const previous = headerReadContext;
  const context: HeaderReadContext = { captured: new WeakMap(), preferred: new WeakMap(), onRead, onConsume };
  for (const snapshot of preferred) {
    const { source } = snapshot;
    if (typeof source === 'object' && source !== null) {
      context.preferred.set(source, () => snapshot.refresh());
    }
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
          ? (context?.preferred.get(originalSource)?.() ?? originalSource)
          : originalSource;
      const provenance = { unknown: false };
      const observed = source && source === originalSource && observesWorkloadHeaderConsumption(source);
      const replay = (context && source === originalSource) || observed ? new HeaderReplay() : undefined;
      const capturedReplay =
        replay ??
        (source && brand_privateNullableHeaders in source
          ? capturedHeaderReplays.get(source)?.replay
          : undefined);
      const entry = {
        source,
        provenance,
        ...(replay ? { replay } : {}),
        entries:
          observed && replay
            ? observeHeaderConsumption(
                source,
                iterateHeaders(source, replay, provenance),
                replay,
                context?.onConsume,
              )
            : iterateHeaders(source, replay, provenance),
      };
      if (!context || typeof originalSource !== 'object' || originalSource === null) return entry;

      // Capture each raw layer separately; merged hook headers cannot seed one source's snapshot.
      const snapshot = mergeHeaderEntries([entry]);
      context.captured.set(originalSource, snapshot);
      if (capturedReplay) {
        capturedHeaderReplays.set(snapshot, {
          source: originalSource,
          replay: copyHeaderReplay(capturedReplay),
        });
      }
      context.onRead?.(originalSource, snapshot);
      return { source: snapshot, provenance: { unknown: true }, entries: iterateHeaders(snapshot) };
    }),
  );
  return result;
};

function* observeHeaderConsumption(
  source: object,
  entries: Iterable<readonly [string, string | null]>,
  replay: HeaderReplay,
  onConsume: ((source: object) => void) | undefined,
): IterableIterator<readonly [string, string | null]> {
  try {
    yield* entries;
  } finally {
    if (!replay.replayable) {
      (onConsume ?? notifyWorkloadHeaderConsumption)(source);
    }
  }
}

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export interface HeaderSnapshot {
  readonly source: HeadersLike;
  readonly snapshot: NullableHeaders;
  readonly refreshable: boolean;
  readonly replayable: boolean;
  readonly initialized: boolean;
  refresh: (...sources: [] | [HeadersLike]) => NullableHeaders;
  seed: (source: HeadersLike, snapshot: NullableHeaders | undefined) => void;
  fork: () => HeaderSnapshot;
}

const createHeaderSnapshot = (
  initialSource: HeadersLike,
  initial?: {
    snapshot?: NullableHeaders;
    refreshable?: boolean;
    deferred?: boolean;
    replay?: HeaderReplay;
    materialization?: { source: HeadersLike; snapshot?: NullableHeaders };
  },
): HeaderSnapshot => {
  let source = initialSource;
  // Forks share only their first materialization; source replacement and replay state stay layer-local.
  const materialization = initial?.materialization ?? { source: initialSource };
  const captured = initial?.snapshot ? capturedHeaderReplays.get(initial.snapshot) : undefined;
  let replay: HeaderReplay =
    initial?.replay ??
    (captured && captured.source === source
      ? copyHeaderReplay(captured.replay)
      : new HeaderReplay(initial?.refreshable));
  let snapshot = initial?.snapshot;
  const inheritMaterialization = () => {
    if (!snapshot && source === materialization.source && materialization.snapshot) {
      snapshot = materialization.snapshot;
      const metadata = capturedHeaderReplays.get(snapshot);
      replay = metadata ? copyHeaderReplay(metadata.replay) : new HeaderReplay(false);
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
    snapshot = mergeHeaderEntries([
      { source, provenance, replay, entries: iterateHeaders(source, replay, provenance) },
    ]);
    capturedHeaderReplays.set(snapshot, { source, replay: copyHeaderReplay(replay) });
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
            entries: iterateHeaders(currentSource, nextReplay, nextProvenance),
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
        capturedHeaderReplays.set(snapshot, { source, replay: copyHeaderReplay(replay) });
        rememberMaterialization();
      }
      return initialize();
    },
    seed: (currentSource, captured) => {
      if (!snapshot && currentSource === source && captured) {
        snapshot = captured;
        const metadata = capturedHeaderReplays.get(captured);
        replay =
          metadata && metadata.source === source
            ? copyHeaderReplay(metadata.replay)
            : new HeaderReplay(false);
        rememberMaterialization();
      }
    },
    fork: () =>
      createHeaderSnapshot(source, {
        ...(snapshot ? { snapshot } : {}),
        deferred: !snapshot,
        replay: copyHeaderReplay(replay),
        materialization,
      }),
  };
};

/** A first parse shared by body encoding and authentication, with safe refresh after async hooks. */
export const snapshotHeaders = (initialSource: HeadersLike): HeaderSnapshot =>
  createHeaderSnapshot(initialSource);

/** Observes native transport serialization before deciding whether its source can be reused. */
export const materializeHeaderInput = (
  source: HeadersInit | undefined,
): { values: Headers; preserve: boolean } => {
  let preserve = canPreserveHeaderInput(source);
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  // Preservation already classified the iterable protocol; do not repeat a caller-controlled has probe.
  const observed =
    source && preserve && !Array.isArray(source) && !hasNativeHeadersBrand(source)
      ? new Proxy(source, {
          getOwnPropertyDescriptor(target, key) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            descriptors.set(key, descriptor);
            return descriptor;
          },
          get(target, key) {
            const value = Reflect.get(target, key, target);
            if (typeof key === 'string') {
              const descriptor = descriptors.get(key);
              if (!descriptor || !('value' in descriptor) || descriptor.value !== value) preserve = false;
            }
            return value;
          },
        })
      : source;
  return { values: new Headers(observed), preserve };
};

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
    ...(capturedDefault ? { snapshot: capturedDefault } : {}),
    refreshable: false,
    deferred: deferDefault && !capturedDefault,
  });
  const capturedRequest = capturedSnapshot(request);
  return {
    defaultHeaders,
    requestHeaders:
      request === defaults
        ? defaultHeaders.fork()
        : createHeaderSnapshot(request, {
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
        return Object.getOwnPropertyDescriptor(prototype, 'headers')?.get?.call(request);
      }
    }
  } catch {
    // A Request-shaped proxy can pass instanceof without satisfying the platform's internal brand.
  }
  return undefined;
};
