import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const examplesPackagePath = path.resolve(process.cwd(), 'examples/package.json');
// SAFETY: The JSON comes from the checked-in SDK/examples package manifests; the test reads their declared dependency metadata.
const examplesPackage = JSON.parse(readFileSync(examplesPackagePath, 'utf-8')) as {
  dependencies: Record<string, string>;
};
// SAFETY: The JSON comes from the checked-in SDK/examples package manifests; the test reads their declared dependency metadata.
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
    // SAFETY: The two fixed subpaths resolve supported Zod packages; this minimal interface is exercised by the parse smoke test immediately below.
    const zod = createRequire(examplesPackagePath)(subpath) as {
      // oxlint-disable-next-line anti-slop/no-unknown-returns -- Dynamically loaded Zod versions return schema-dependent values checked by this resolution smoke test. The stub accepts schema fields from independently loaded examples without claiming their runtime parser types.
      z: { object: (properties: Record<string, unknown>) => { parse: (input: unknown) => unknown } };
    };

    expect(zod.z.object({}).parse({})).toEqual({});
  });
});
