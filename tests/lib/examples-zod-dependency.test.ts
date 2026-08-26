import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const examplesPackagePath = path.resolve(process.cwd(), 'examples/package.json');
const examplesPackage = JSON.parse(readFileSync(examplesPackagePath, 'utf-8')) as {
  dependencies: Record<string, string>;
};
const sdkPackage = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

describe('standalone structured-output examples', () => {
  test('declare the optional SDK peer directly across both supported Zod major versions', () => {
    expect(examplesPackage.dependencies['zod']).toBe(sdkPackage.peerDependencies['zod']);
    expect(sdkPackage.peerDependenciesMeta['zod']?.optional).toBe(true);
  });

  test.each(['zod/v3', 'zod/v4'])('resolve %s from the examples package', (subpath) => {
    const zod = createRequire(examplesPackagePath)(subpath) as {
      z: { object: (shape: Record<string, unknown>) => { parse: (input: unknown) => unknown } };
    };

    expect(zod.z.object({}).parse({})).toEqual({});
  });
});
