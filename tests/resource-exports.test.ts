import { readdirSync } from 'node:fs';
import nodePath from 'node:path';

const repositoryRoot = nodePath.join(__dirname, '..');
const resourcesDirectory = nodePath.join(repositoryRoot, 'src', 'resources');

function findResourceIndexes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = nodePath.join(directory, entry.name);

    if (entry.isDirectory()) {
      return findResourceIndexes(path);
    }
    return entry.name === 'index.ts' ? [path] : [];
  });
}

const realtimeModules = ['realtime', 'beta/realtime'].flatMap((directory) => {
  const moduleDirectory = nodePath.join(repositoryRoot, 'src', directory);

  return readdirSync(moduleDirectory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => nodePath.join(moduleDirectory, name));
});

const resourceIndexes = [...findResourceIndexes(resourcesDirectory), ...realtimeModules].map(
  (modulePath) => ({
    path: nodePath.relative(repositoryRoot, modulePath),
    modulePath,
  }),
);

describe.each(resourceIndexes)('SDK exports: $path', ({ modulePath }) => {
  test('exposes every declared runtime export', async () => {
    // SAFETY: Dynamic import returns a module namespace object; this test enumerates its runtime export names without assuming their value types.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Dynamic module loading returns heterogeneous runtime exports; the test validates their names and presence.
    const exports = (await import(modulePath)) as Record<string, unknown>;
    const names = Object.keys(exports);

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(exports[name]).toBeDefined();
    }
  });
});
