import { buildHeaders } from './headers';
import type { RequestOptions } from './request-options';
import { isSensitiveHeader } from './utils/log';

// Recognizable options across SDK runtime versions. Keep this independent of
// private RequestOptions fields so older handwritten runtimes still compile.
const requestOptionKeys = [
  'method',
  'path',
  'query',
  'body',
  'headers',
  'maxRetries',
  'stream',
  'timeout',
  'httpAgent',
  'fetchOptions',
  'signal',
  'idempotencyKey',
  'defaultBaseURL',
  '__metadata',
  '__binaryRequest',
  '__binaryResponse',
  '__streamClass',
  '__security',
  '__synthesizeEventData',
] as const;
type RequestOptionKey = (typeof requestOptionKeys)[number];
const recognizedOptions: ReadonlySet<string> = new Set(requestOptionKeys);
const legacyOptionKeys = ['headers', 'timeout', 'signal', 'idempotencyKey', 'query'] as const;
const supportedOptions: ReadonlySet<string> = new Set(legacyOptionKeys);

/** Options accepted in the query position of unambiguous legacy GET calls. */
export type LegacyRequestOptions = {
  [K in (typeof legacyOptionKeys)[number]]?: RequestOptions[K];
};

/** Query parameters must keep request-only options in their separate argument. */
export type QueryOptions<Query> = Query & {
  [K in Exclude<RequestOptionKey, keyof Query>]?: never;
};

/**
 * Recognizes legacy options-only GET calls and snapshots their supported fields.
 * Mixed query/options objects, retry controls, transport overrides, and security-sensitive
 * headers require the explicit request options argument and throw before dispatch.
 */
export function normalizeRequestOptionsForQuery(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function parses the caller-supplied query/options boundary, including JavaScript callers.
  value: unknown,
  queryKeys: readonly string[],
  options: RequestOptions | undefined,
): LegacyRequestOptions | undefined {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only objects have query/option fields to inspect at this boundary.
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  // Optional never fields can still be explicitly undefined unless consumers
  // enable exactOptionalPropertyTypes. Snapshot data without invoking getters.
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).filter(
    ([, descriptor]) => descriptor.enumerable && (!('value' in descriptor) || descriptor.value !== undefined),
  );
  const keys = entries.map(([key]) => key);
  const requestOnly = keys.some((key) => recognizedOptions.has(key) && !queryKeys.includes(key));
  if (!requestOnly) {
    return undefined;
  }
  if (options !== undefined || keys.some((key) => !recognizedOptions.has(key) || queryKeys.includes(key))) {
    throw new TypeError('Query parameters and request options must be passed as separate arguments.');
  }
  if (keys.some((key) => !supportedOptions.has(key))) {
    throw new TypeError('Pass transport overrides in the explicit request options argument.');
  }
  // Copy only validated fields without mutating the caller's object.
  const normalized: LegacyRequestOptions = Object.fromEntries(
    entries.map(([key, descriptor]) => {
      if ('value' in descriptor) {
        return [key, descriptor.value];
      }
      // oxlint-disable-next-line anti-slop/no-reflect-apply -- Invoke the captured getter without consulting caller-owned call/apply properties.
      return [key, descriptor.get ? Reflect.apply(descriptor.get, value, []) : undefined];
    }),
  );
  if (normalized.headers !== undefined && normalized.headers !== null) {
    const headers = buildHeaders([normalized.headers]);
    const names = [...headers.values.keys(), ...headers.nulls];
    if (
      names.some(
        (name) =>
          isSensitiveHeader(name) ||
          name === 'openai-organization' ||
          name === 'openai-project' ||
          name === 'host',
      )
    ) {
      throw new TypeError('Pass security-sensitive headers in the explicit request options argument.');
    }
    // Forward the same parsed snapshot that was validated, including null deletions.
    normalized.headers = headers;
  }
  return normalized;
}
