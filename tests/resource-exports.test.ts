import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const repositoryRoot = join(__dirname, '..');
const resourcesDirectory = join(repositoryRoot, 'src', 'resources');

function findResourceIndexes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return findResourceIndexes(path);
    return entry.name === 'index.ts' ? [path] : [];
  });
}

const realtimeModules = ['realtime', 'beta/realtime'].flatMap((directory) => {
  const moduleDirectory = join(repositoryRoot, 'src', directory);

  return readdirSync(moduleDirectory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(moduleDirectory, name));
});

const resourceIndexes = [...findResourceIndexes(resourcesDirectory), ...realtimeModules].map(
  (modulePath) => ({
    path: relative(repositoryRoot, modulePath),
    modulePath,
  }),
);

describe.each(resourceIndexes)('SDK exports: $path', ({ modulePath }) => {
  test('exposes every declared runtime export', async () => {
    const exports = (await import(modulePath)) as Record<string, unknown>;
    const names = Object.keys(exports);

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(exports[name]).toBeDefined();
    }
  });
});
