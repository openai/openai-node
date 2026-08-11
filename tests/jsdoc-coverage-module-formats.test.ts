import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectSource } from './helpers/jsdoc-coverage';

const requireCoverageCompiler = createRequire(`${process.cwd()}/package.json`);
const { collectSourceFiles } = requireCoverageCompiler('./scripts/jsdoc-coverage-compiler.cjs') as {
  collectSourceFiles: (directory: string) => string[];
};

describe('handwritten SDK declaration module formats', () => {
  test('checks internal children exposed by namespace-star re-export aliases', () => {
    const source = `
      export * as Public from './internal-namespace';
    `;
    const dependencies = {
      'src/internal-namespace.ts': `
        /** @internal */
        export interface Hidden {
          missing: { nested: string };
          /** @internal */ implementation: boolean;
        }
        /** Already audited through the original handwritten module. */
        export interface Ordinary {
          ignored: string;
        }
        /** @internal */
        export namespace Group {
          export interface Shape {
            missing: string;
          }
          export import Again = Group;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.Hidden.missing',
        'Public.Hidden.missing.nested',
        'Public.Group.Shape.missing',
      ]),
    );
    expect(undocumented).not.toContain('Public.Ordinary.ignored');
    expect(undocumented).not.toContain('Public.Hidden.implementation');
    expect(undocumented.some((name) => name.includes('Again.Again'))).toBe(false);
    expect(declarations.find(({ name }) => name === 'Public.Hidden.missing')).toEqual(
      expect.objectContaining({ file: 'src/internal-namespace.ts', line: 4 }),
    );
  });

  test.each(['ts', 'tsx', 'mts', 'cts'])('checks handwritten .%s declaration surfaces', (extension) => {
    const declarations = inspectSource(
      `src/fixture.${extension}`,
      '/** Public declaration. */\nexport interface Public { missing: string; }',
    );

    expect(declarations.find(({ name }) => name === 'Public.missing')).toEqual(
      expect.objectContaining({ file: `src/fixture.${extension}`, line: 2, documented: false }),
    );
  });

  test('emits declarations and source positions for actual JSX source', () => {
    const source = `
      declare namespace JSX {
        interface IntrinsicElements {
          widget: unknown;
        }
      }
      /** Public JSX component. */
      export function Component(props: { missing: string }) {
        return <widget />;
      }
    `;

    expect(inspectSource('src/component.tsx', source).filter(({ documented }) => !documented)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Component.props.missing' })]),
    );
  });

  test('discovers supported handwritten source formats and excludes declarations, generated, and vendored files', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openai-node-jsdoc-formats-'));
    try {
      for (const extension of ['ts', 'tsx', 'mts', 'cts']) {
        writeFileSync(path.join(directory, `handwritten.${extension}`), 'export interface Public {}');
      }
      for (const extension of ['d.ts', 'd.mts', 'd.cts', 'js', 'jsx']) {
        writeFileSync(path.join(directory, `ignored.${extension}`), 'export interface Ignored {}');
      }
      writeFileSync(
        path.join(directory, 'generated.mts'),
        '// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.\nexport {};',
      );
      const vendor = path.join(directory, '_vendor');
      mkdirSync(vendor);
      writeFileSync(path.join(vendor, 'ignored.tsx'), 'export interface Ignored {}');

      expect(new Set(collectSourceFiles(directory).map((file) => path.basename(file)))).toEqual(
        new Set(['handwritten.cts', 'handwritten.mts', 'handwritten.ts', 'handwritten.tsx']),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('keeps overloaded signature generic constraints and defaults independently documented', () => {
    const source = `
      /** Public overloaded client. */
      export interface Client {
        /** Sends a generic typed request. */
        send<Value extends {
          /** First overload constraint. */
          shared: string;
        } = {
          /** First overload default. */
          shared: string;
        }>(): void;
        send<Value extends { shared: string } = { shared: string }>(): void;
      }
    `;
    const declarations = inspectSource('src/fixture.ts', source);

    expect(declarations.filter(({ documented }) => !documented).map(({ name }) => name)).toContain(
      'Client.send.Value.shared',
    );
    expect(declarations.filter(({ name }) => name === 'Client.send')).toHaveLength(1);
  });

  test('does not merge documentation between crossed overload constraints and defaults', () => {
    const source = `
      /** Public overloaded client. */
      export interface Client {
        /** Public generic request. */
        send<Value extends {
          /** Only the first overload constraint is documented. */
          shared: string;
        } = {
          shared: string;
        }>(): void;
        send<Value extends {
          shared: string;
        } = {
          /** Only the second overload default is documented. */
          shared: string;
        }>(): void;
      }
    `;
    const declarations = inspectSource('src/fixture.ts', source).filter(
      ({ name }) => name === 'Client.send.Value.shared',
    );

    expect(declarations).toHaveLength(4);
    expect(declarations.filter(({ documented }) => !documented)).toHaveLength(2);
  });

  test('keeps declaration-merged interface overload fields independently documented', () => {
    const source = `
      /** Public merged client. */
      export interface Client {
        /** Sends the first merged overload. */
        send(options: {
          /** First merged overload. */
          shared: string;
        }): void;
      }
      /** Second merged declaration. */
      export interface Client {
        send(options: { shared: string }): void;
      }
    `;
    const declarations = inspectSource('src/fixture.ts', source);

    expect(declarations.filter(({ documented }) => !documented).map(({ name }) => name)).toContain(
      'Client.send.options.shared',
    );
    expect(declarations.filter(({ name }) => name === 'Client.send')).toHaveLength(1);
  });

  test('forwards deferred generic arguments through cross-module inherited promise wrappers', () => {
    const source = `
      import type { Wrapper } from './promise-wrapper';

      /** Selects an inherited promise wrapper. */
      type Select<Value, Yes, No> = Value extends string ? Wrapper<Yes> : Wrapper<No>;
      /** Public dictionary with deferred wrapped values. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;
    const dependencies = {
      'src/promise-wrapper.ts': `
        /** Cross-module handwritten promise wrapper. */
        export interface Wrapper<Value> extends Promise<Value> {}
      `,
    };

    expect(
      inspectSource('src/fixture.ts', source, dependencies)
        .filter(({ documented }) => !documented)
        .map(({ name }) => name),
    ).toEqual(expect.arrayContaining(['Public.[key: Key].missing', 'Public.[key: Key].other']));
  });

  test.each([
    [
      'an interface',
      'export interface Wrapper<Value> extends Promise<Value> {\n/** Identifier. */\nid: string }',
    ],
    [
      'a class',
      'export declare class Wrapper<Value> extends Promise<Value> {\n/** Identifier. */\nid: string }',
    ],
    [
      'an intersection alias',
      'export type Wrapper<Value> = Promise<Value> & {\n/** Identifier. */\nid: string }',
    ],
    [
      'multiple bases',
      '/** Marker. */ interface Marker {\n/** Label. */\nlabel: string } export interface Wrapper<Value> extends Promise<Value>, Marker {\n/** Identifier. */\nid: string }',
    ],
  ])('forwards inherited generic values through %s with unrelated members', (_description, declaration) => {
    const source = `
      import type { Wrapper } from './promise-wrapper';
      /** Chooses an inherited wrapper. */
      type Select<Value, Yes, No> = Value extends string ? Wrapper<Yes> : Wrapper<No>;
      /** Public deferred dictionary. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;
    const dependencies = { 'src/promise-wrapper.ts': declaration };

    expect(
      inspectSource('src/fixture.ts', source, dependencies)
        .filter(({ documented }) => !documented)
        .map(({ name }) => name),
    ).toEqual(expect.arrayContaining(['Public.[key: Key].missing', 'Public.[key: Key].other']));
  });

  test('does not audit unused external generic arguments', () => {
    const source = `
      import type { Wrapper } from './unused-wrapper';
      /** Chooses a wrapper without exposing its generic argument. */
      type Select<Value, Yes, No> = Value extends string ? Wrapper<Yes> : Wrapper<No>;
      /** Public deferred dictionary. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;
    const dependencies = {
      'src/unused-wrapper.ts': `
        /** Wrapper that does not expose Value. */
        export interface Wrapper<Value> {
          /** Public identifier. */
          id: string;
        }
      `,
    };

    expect(
      inspectSource('src/fixture.ts', source, dependencies).filter(({ documented }) => !documented),
    ).toEqual([]);
  });

  test.each([
    ['an inherited object', '{ wrapped: Value }'],
    ['an inherited array', 'Value[]'],
  ])('substitutes generic values nested inside %s', (_description, inherited) => {
    const source = `
      import type { Wrapper } from './nested-wrapper';
      /** Chooses a nested inherited wrapper. */
      type Select<Value, Yes, No> = Value extends string ? Wrapper<Yes> : Wrapper<No>;
      /** Public deferred dictionary. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;
    const dependencies = {
      'src/nested-wrapper.ts': `
        /** Nested promise wrapper. */
        export interface Wrapper<Value> extends Promise<${inherited}> {
          /** Public identifier. */
          id: string;
        }
      `,
    };
    const undocumented = inspectSource('src/fixture.ts', source, dependencies)
      .filter(({ documented }) => !documented)
      .map(({ name }) => name);

    expect(undocumented.some((name) => name.endsWith('.missing'))).toBe(true);
    expect(undocumented.some((name) => name.endsWith('.other'))).toBe(true);
    if (inherited.includes('wrapped')) {
      expect(undocumented).toContain('Public.[key: Key].wrapped.missing');
      expect(undocumented).toContain('Public.[key: Key].wrapped.other');
    }
  });

  test.each([
    [
      'callable',
      '((options: {\n/** First option. */\nshared: string }) => {\n/** First result. */\nresult: string }) & ((options: { shared: string }) => { result: string })',
    ],
    [
      'constructable',
      '(new (options: {\n/** First option. */\nshared: string }) => {\n/** First result. */\nresult: string }) & (new (options: { shared: string }) => { result: string })',
    ],
    [
      'call-signature',
      '{ (options: {\n/** First option. */\nshared: string }): {\n/** First result. */\nresult: string } } & { (options: { shared: string }): { result: string } }',
    ],
  ])('keeps %s intersection constituent fields independently documented', (_description, type) => {
    const source = `/** Public overloaded intersection. */\nexport type Public = ${type};`;
    const declarations = inspectSource('src/fixture.ts', source);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented.some((name) => name.endsWith('.shared'))).toBe(true);
    expect(undocumented.some((name) => name.endsWith('.result'))).toBe(true);
    expect(declarations.filter(({ name }) => name === 'Public')).toHaveLength(1);
  });

  test('continues merging shared properties in ordinary object intersections', () => {
    const source = `
      /** Public object intersection. */
      export type Public = {
        /** Shared field documentation. */
        shared: string;
      } & {
        shared: string;
      };
    `;
    const declarations = inspectSource('src/fixture.ts', source);

    expect(declarations.filter(({ name }) => name === 'Public.shared')).toHaveLength(1);
    expect(declarations.filter(({ documented }) => !documented)).toEqual([]);
  });

  test('does not audit the private object behind a public keyof projection', () => {
    const source = `
      interface Shape {
        hidden: string;
        nested: { missing: string };
      }
      /** Public key names without their underlying value shapes. */
      export type Public = keyof Shape;
    `;
    const declarations = inspectSource('src/fixture.ts', source);

    expect(declarations.map(({ name }) => name)).toEqual(['Public']);
    expect(declarations.filter(({ documented }) => !documented)).toEqual([]);
  });

  test('checks constraints and defaults on publicly exposed internal callable signatures', () => {
    const source = `
      export { Hidden as Public } from './internal-callable';
    `;
    const dependencies = {
      'src/internal-callable.ts': `
        /** @internal */
        export interface Hidden {
          /** Public generic callable. */
          call<Value extends { missing: string } = { other: string }>(): void;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);

    expect(declarations.filter(({ documented }) => !documented).map(({ name }) => name)).toEqual(
      expect.arrayContaining(['Public.call.Value.missing', 'Public.call.Value.other']),
    );
  });
});
