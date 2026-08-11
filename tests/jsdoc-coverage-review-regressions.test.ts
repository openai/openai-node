import { inspectSource, missing } from './helpers/jsdoc-coverage';

describe('JSDoc coverage review regressions', () => {
  test('inspects every viable branch of deferred generic mapped dictionary values', () => {
    const source = `
      /** Public generic dictionary with a deferred conditional value. */
      export type Public<Key extends string, Value> = {
        [Current in Key]: Value extends string ? { missing: string } : { other: string };
      };
      /** Public generic Record with a deferred conditional value. */
      export type PublicRecord<Key extends string, Value> = Record<
        Key,
        Value extends string ? { missing: string } : { other: string }
      >;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Public.[key: Key].missing',
        'Public.[key: Key].other',
        'PublicRecord.[key: Key].missing',
        'PublicRecord.[key: Key].other',
      ]),
    );
  });

  test('does not inspect impossible branches of resolved conditional dictionary values', () => {
    const source = `
      /** Public dictionary with a resolved documented branch. */
      export type Public = Record<
        string,
        string extends string
          ? {
              /** Public selected value. */
              selected: string;
            }
          : { impossible: string }
      >;
      /** Public dictionary without any keys. */
      export type Empty = Record<
        never,
        string extends string ? { impossible: string } : { alsoImpossible: string }
      >;
    `;

    expect(missing(source)).toEqual([]);
  });

  test('keeps documentation independent when deferred conditional branches share a property', () => {
    const source = `
      /** Selects a shape after the generic argument is known. */
      type Select<Value> = Value extends string
        ? {
            /** Present on the documented branch. */
            shared: string;
          }
        : {
            shared: string;
          };
      /** Public unresolved conditional dictionary. */
      export type Public<Key extends string, Value> = {
        [Current in Key]: Select<Value>;
      };
    `;

    expect(missing(source)).toContain('Public.[key: Key].shared');
  });

  test('does not expose discarded branches from concretely instantiated local conditional aliases', () => {
    const source = `
      /** Selects a documented branch after instantiation. */
      type Select<Value> = Value extends string
        ? {
            /** Public selected value. */
            selected: string;
          }
        : {
            discarded: string;
          };
      /** Public concretely selected value. */
      export type Public = Select<'accepted'>;
    `;

    expect(missing(source)).toEqual([]);
  });

  test('preserves directly exposed conditional aliases and documented conditional constraint fields', () => {
    const source = `
      /** Native runtime constructor type. */
      type Native = typeof globalThis extends {
        /** Public runtime-provided constructor. */
        WebSocket: infer Constructor;
      }
        ? Constructor
        : unknown;
      /** Extracts an array element while preserving other values. */
      type Unpacked<Value> = Value extends (infer Element)[] ? Element : Value;
      /** Alias exposed through a public signature. */
      type Tool = Unpacked<string[]>;
      /** Public runtime-facing shape. */
      export interface Public {
        /** Native runtime value. */
        native: Native;
        /** Selected public tool value. */
        tool: Tool;
      }
    `;
    const declarations = inspectSource('src/fixture.ts', source);

    expect(declarations.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['Native', 'Native.WebSocket', 'Unpacked']),
    );
    expect(declarations.filter(({ documented }) => !documented)).toEqual([]);
  });

  test('checks public interface inheritance and property shapes from internal local interfaces', () => {
    const source = `
      /** @internal */
      interface Internal {
        inherited(options: { nested: string }): { output: string };
        value: { missing: string };
        /** @internal */ implementation: boolean;
      }
      /** Public inherited shape. */
      export interface Public extends Internal {}
      /** Public containing shape. */
      export interface Container {
        /** Exposed internal interface shape. */
        value: Internal;
      }
    `;

    const undocumented = missing(source);
    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.inherited',
        'Public.inherited.options.nested',
        'Public.inherited.result.output',
        'Public.value',
        'Public.value.missing',
        'Container.value.inherited',
        'Container.value.inherited.options.nested',
        'Container.value.value',
        'Container.value.value.missing',
      ]),
    );
    expect(undocumented).not.toContain('Internal');
    expect(undocumented).not.toContain('Public.implementation');
    expect(undocumented).not.toContain('Container.value.implementation');
  });

  test('maps inherited internal interface fields to their original handwritten module', () => {
    const source = `
      import type { Internal } from './internal-shape';

      /** Public inherited interface. */
      export interface Public extends Internal {}
      /** Public containing interface. */
      export interface Container {
        /** Exposed inherited shape. */
        value: Internal;
      }
    `;
    const dependencies = {
      'src/internal-shape.ts': `
        /** @internal */
        export interface Internal {
          inherited: { missing: string };
          /** @internal */ implementation: boolean;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.inherited',
        'Public.inherited.missing',
        'Container.value.inherited',
        'Container.value.inherited.missing',
      ]),
    );
    expect(undocumented).not.toContain('Internal');
    expect(undocumented).not.toContain('Public.implementation');
    expect(declarations.find(({ name }) => name === 'Public.inherited')).toEqual(
      expect.objectContaining({ file: 'src/internal-shape.ts', line: 4 }),
    );
    expect(declarations.find(({ name }) => name === 'Container.value.inherited')).toEqual(
      expect.objectContaining({ file: 'src/internal-shape.ts', line: 4 }),
    );
  });

  test('checks handwritten global script declarations without module exports', () => {
    const source = `
      interface OpenAIConfig {
        missing: string;
      }
      /** Public global namespace. */
      declare namespace OpenAISDK {
        interface Options {
          nested: string;
        }
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'OpenAIConfig',
        'OpenAIConfig.missing',
        'OpenAISDK.Options',
        'OpenAISDK.Options.nested',
      ]),
    );
  });

  test('checks declare-global augmentations without exposing ordinary module-local declarations', () => {
    const source = `
      const privateImplementation = true;
      export {};

      declare global {
        interface OpenAIConfig {
          missing: string;
        }
      }
    `;
    const undocumented = missing(source);

    expect(undocumented).toEqual(
      expect.arrayContaining(['global.OpenAIConfig', 'global.OpenAIConfig.missing']),
    );
    expect(undocumented).not.toContain('privateImplementation');
  });

  test('checks interfaces exposed by handwritten ambient module declarations', () => {
    const source = `
      declare module 'openai/custom' {
        interface Options {
          missing: string;
        }
        export { Options };
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['openai/custom.Options', 'openai/custom.Options.missing']),
    );
  });
});
