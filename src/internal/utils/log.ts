// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { LogLevel, Logger } from '../../client';
import { type OpenAI } from '../../client';
import { RequestOptions } from '../request-options';

const levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500,
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

let cachedLoggers = new WeakMap<Logger, [LogLevel, Logger]>();

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
  }
  if (details.headers) {
    details.headers = Object.fromEntries(
      (details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(
        ([name, value]) => [
          name,
          (
            name.toLowerCase() === 'authorization' ||
            name.toLowerCase() === 'cookie' ||
            name.toLowerCase() === 'set-cookie'
          ) ?
            '***'
          : value,
        ],
      ),
    );
  }
  if ('retryOfRequestLogID' in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};
