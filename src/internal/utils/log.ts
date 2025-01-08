// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { LogLevel, Logger } from '../../client';
import { type OpenAI } from '../../client';

const levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500,
};

function noop() {}

function logFn(logger: Logger | undefined, clientLevel: LogLevel | undefined, level: keyof Logger) {
  if (!logger || levelNumbers[level] > levelNumbers[clientLevel!]!) {
    return noop;
  } else {
    // Don't wrap logger functions, we want the stacktrace intact!
    return logger[level].bind(logger);
  }
}

let lastLogger: { deref(): Logger } | undefined;
let lastLevel: LogLevel | undefined;
let lastLevelLogger: Logger;

export function logger(client: OpenAI): Logger {
  let { logger, logLevel: clientLevel } = client;
  if (lastLevel === clientLevel && (logger === lastLogger || logger === lastLogger?.deref())) {
    return lastLevelLogger;
  }
  const levelLogger = {
    error: logFn(logger, clientLevel, 'error'),
    warn: logFn(logger, clientLevel, 'warn'),
    info: logFn(logger, clientLevel, 'info'),
    debug: logFn(logger, clientLevel, 'debug'),
  };
  const { WeakRef } = globalThis as any;
  lastLogger =
    logger ?
      WeakRef ? new WeakRef(logger)
      : { deref: () => logger }
    : undefined;
  lastLevel = clientLevel;
  lastLevelLogger = levelLogger;
  return levelLogger;
}
