import path from 'node:path';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    compiledFixtures: string;
  }
}

/** Resolve a script from the invocation's immutable transpiled source snapshot. */
export function compiledFixture(...parts: string[]): string {
  return path.join(inject('compiledFixtures'), ...parts).replace(/\.(?:c)?ts$/u, '.js');
}

/** Retain tsconfig-paths aliases while resolving the precompiled SDK in subprocesses. */
export function compiledFixtureConfig(): string {
  return path.join(inject('compiledFixtures'), 'tsconfig.json');
}
