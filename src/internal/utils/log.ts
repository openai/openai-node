import { hasOwn } from './values';
import { type OpenAI } from '../../client';
import { RequestOptions } from '../request-options';

type LogFn = (message: string, ...rest: unknown[]) => void;
export type Logger = {
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
};
export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

const levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500,
};

export const parseLogLevel = (
  maybeLevel: string | undefined,
  sourceName: string,
  client: OpenAI,
): LogLevel | undefined => {
  if (!maybeLevel) {
    return undefined;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(
    `${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(
      Object.keys(levelNumbers),
    )}`,
  );
  return undefined;
};

function noop() {}

function makeLogFn(fnLevel: keyof Logger, logger: Logger | undefined, logLevel: LogLevel) {
  if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    // Don't wrap logger functions, we want the stacktrace intact!
    return logger[fnLevel].bind(logger);
  }
}

const noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
};

let cachedLoggers = /* @__PURE__ */ new WeakMap<Logger, [LogLevel, Logger]>();

export function loggerFor(client: OpenAI): Logger {
  const logger = client.logger;
  const logLevel = client.logLevel ?? 'off';
  if (!logger) {
    return noopLogger;
  }

  const cachedLogger = cachedLoggers.get(logger);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }

  const levelLogger = {
    error: makeLogFn('error', logger, logLevel),
    warn: makeLogFn('warn', logger, logLevel),
    info: makeLogFn('info', logger, logLevel),
    debug: makeLogFn('debug', logger, logLevel),
  };

  cachedLoggers.set(logger, [logLevel, levelLogger]);

  return levelLogger;
}

const sensitiveQueryNames = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'sessionid',
  'idtoken',
  'authtoken',
  'authorization',
  'token',
  'password',
  'clientsecret',
  'signingsecret',
  'xamzsecuritytoken',
  'xamzsignature',
  'xamzcredential',
]);

/** Recognizes credential-bearing query names across ordinary and provider authentication. */
export function isSensitiveQueryParameter(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[-_]/gu, '');
  return sensitiveQueryNames.has(normalized) || sensitiveQueryNames.has(normalized.replace(/^x/u, ''));
}

const sensitiveHeaderNames = new Set([
  'authorization',
  'proxy-authorization',
  'api-key',
  'x-api-key',
  'x-amz-security-token',
  'cookie',
  'set-cookie',
  'x-session-token',
  'x-session-id',
  'x-auth-token',
  'x-id-token',
]);

/** Recognizes credential-bearing request headers across provider and workload authentication. */
export function isSensitiveHeader(name: string): boolean {
  return sensitiveHeaderNames.has(name.toLowerCase().replace(/_/gu, '-')) || isSensitiveQueryParameter(name);
}

/** Removes credential-valued query parameters before a request URL reaches any logger. */
export function redactURL(value: string): string {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const name of url.searchParams.keys()) {
    if (isSensitiveQueryParameter(name)) {
      url.searchParams.set(name, '***');
    }
  }
  return url.href;
}

/** Redacts JSON diagnostics without mutating caller values, sharing unchanged branches. */
function redactBody(body: unknown): unknown {
  type Frame = {
    source: object;
    target: object;
    keys: Iterator<string | number>;
    parentName: string | undefined;
  };
  const copies = new WeakMap<object, object>();
  const active = new WeakMap<object, Frame>();
  const pending: Frame[] = [];
  // Parsed JSON arrays have only indexed elements; never materialize their index keys.
  const keysFor = (value: object): Iterator<string | number> =>
    Array.isArray(value) ? Array.prototype.keys.call(value) : Object.keys(value)[Symbol.iterator]();
  const write = (target: object, name: string, value: unknown) => {
    Object.defineProperty(target, name, { value, enumerable: true, configurable: true, writable: true });
  };
  const writable = (frame: Frame): object => {
    if (frame.target !== frame.source) return frame.target;
    const target = Array.isArray(frame.source) ? new Array(frame.source.length) : {};
    frame.target = target;
    copies.set(frame.source, target);
    const keys = keysFor(frame.source);
    for (let key = keys.next(); !key.done; key = keys.next()) {
      const name = String(key.value);
      const descriptor = Object.getOwnPropertyDescriptor(frame.source, name);
      if (descriptor?.enumerable) {
        write(target, name, 'value' in descriptor ? descriptor.value : '[Accessor]');
      }
    }
    return target;
  };
  const visit = (value: unknown, name?: string): unknown => {
    if (typeof value === 'function') return '[Function]';
    if (typeof value === 'string' && name?.toLowerCase() === 'url') {
      // JSON payload URLs can carry credentials in any component, including the path.
      return '***';
    }
    if (value === null || typeof value !== 'object') return value;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
    const existing = copies.get(value);
    if (existing) return existing;
    // Cycles are not JSON, but diagnostic callers may supply them. Preserve their links safely.
    const ancestor = active.get(value);
    if (ancestor) return writable(ancestor);
    const frame = { source: value, target: value, keys: keysFor(value), parentName: name };
    active.set(value, frame);
    pending.push(frame);
    return value;
  };

  let result = visit(body);
  for (let frame = pending[pending.length - 1]; frame; frame = pending[pending.length - 1]) {
    const key = frame.keys.next();
    if (key.done) {
      pending.pop();
      active.delete(frame.source);
      const parent = pending[pending.length - 1];
      if (!parent) result = frame.target;
      else if (frame.target !== frame.source && frame.parentName !== undefined) {
        write(writable(parent), frame.parentName, frame.target);
      }
      continue;
    }
    const name = String(key.value);
    const descriptor = Object.getOwnPropertyDescriptor(frame.source, name);
    if (!descriptor?.enumerable) continue;
    const value = 'value' in descriptor ? descriptor.value : '[Accessor]';
    const redacted = isSensitiveHeader(name) ? '***' : visit(value, name);
    if (!('value' in descriptor) || redacted !== value) {
      write(writable(frame), name, redacted);
    }
  }
  return result;
}

export const formatRequestDetails = (details: {
  options?: RequestOptions | undefined;
  headers?: Headers | Record<string, string> | undefined;
  retryOfRequestLogID?: string | undefined;
  retryOf?: string | undefined;
  url?: string | undefined;
  status?: number | undefined;
  method?: string | undefined;
  durationMs?: number | undefined;
  message?: unknown;
  body?: unknown;
}) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options['headers']; // redundant + leaks internals
    if ('body' in details.options) {
      details.options.body = redactBody(details.options.body);
    }
    if (details.options.path) {
      const path = details.options.path;
      const redacted = new URL(redactURL(new URL(path, 'https://redacted.invalid').href));
      details.options.path =
        redacted.origin === 'https://redacted.invalid'
          ? `${path.startsWith('/') ? '/' : ''}${redacted.pathname.slice(1)}${redacted.search}`
          : redacted.href;
    }
    if (details.options.query) {
      details.options.query = Object.fromEntries(
        Object.entries(details.options.query).map(([name, value]) => [
          name,
          isSensitiveQueryParameter(name) ? '***' : value,
        ]),
      );
    }
  }
  if (details.url) {
    details.url = redactURL(details.url);
  }
  if (details.headers) {
    details.headers = Object.fromEntries(
      (details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(
        ([name, value]) => [name, isSensitiveHeader(name) ? '***' : value],
      ),
    );
  }
  if ('body' in details) {
    details.body = redactBody(details.body);
  }
  if ('retryOfRequestLogID' in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};
