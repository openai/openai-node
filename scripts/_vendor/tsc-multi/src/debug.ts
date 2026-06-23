import { debuglog } from 'util';

type DebugLogger = ((formatter: string, ...args: unknown[]) => void) & {
  extend(name: string): DebugLogger;
};

function createLogger(namespace: string): DebugLogger {
  const log = debuglog(namespace);
  const logger = ((formatter: string, ...args: unknown[]) => {
    log(formatter, ...args);
  }) as DebugLogger;
  logger.extend = (name: string) => createLogger(`${namespace}:${name}`);
  return logger;
}

export default createLogger('tsc-multi');
