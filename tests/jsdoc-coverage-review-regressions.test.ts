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

  test('instantiates forwarded conditional alias branches before checking their visible properties', () => {
    const source = `
      /** Selects one generic branch after the value type is known. */
      type Select<Value, Yes, No> = Value extends string ? Yes : No;
      /** Public dictionary forwarding both concrete branch shapes. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['Public.[key: Key].missing', 'Public.[key: Key].other']),
    );
  });

  test('propagates conditional branch substitutions through nested generic object wrappers', () => {
    const source = `
      /** Wraps a conditional branch value. */
      type Box<Value> = { value: Value };
      /** Selects one wrapped unresolved generic branch. */
      type Select<Value, Yes, No> = Value extends string ? Box<Yes> : Box<No>;
      /** Public dictionary forwarding wrapped branch shapes. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['Public.[key: Key].value.missing', 'Public.[key: Key].value.other']),
    );
  });

  test('propagates substituted conditional branches through external generic containers', () => {
    const source = `
      /** Forwards conditional values through runtime promise wrappers. */
      type Select<Value, Yes, No> = Value extends string ? Promise<Yes> : Promise<No>;
      /** Public dictionary exposing the eventual conditional value. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['Public.[key: Key].missing', 'Public.[key: Key].other']),
    );
  });

  test('follows deferred conditional values through cross-module handwritten generic wrappers', () => {
    const source = `
      import type { Wrapper } from './wrapper';

      /** Selects a cross-module wrapper after the value is known. */
      type Select<Value, Yes, No> = Value extends string ? Wrapper<Yes> : Wrapper<No>;
      /** Public dictionary exposing wrapped conditional branches. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<Value, { missing: string }, { other: string }>
      >;
    `;
    const dependencies = {
      'src/wrapper.ts': `
        /** Handwritten wrapper already audited in its own module. */
        export interface Wrapper<Value> {
          /** Wrapped public value. */
          value: Value;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining(['Public.[key: Key].value.missing', 'Public.[key: Key].value.other']),
    );
    expect(declarations.map(({ name }) => name)).not.toContain('Wrapper');
  });

  test('keeps substituted conditional alias branch documentation independent', () => {
    const source = `
      /** Forwards one unresolved generic branch. */
      type Select<Value, Yes, No> = Value extends string ? Yes : No;
      /** Public dictionary with independently documented forwarded branches. */
      export type Public<Key extends string, Value> = Record<
        Key,
        Select<
          Value,
          {
            /** Documented in only the first branch. */
            shared: string;
          },
          {
            shared: string;
          }
        >
      >;
    `;

    expect(missing(source)).toContain('Public.[key: Key].shared');
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

  test('checks cross-file shapes made internal by an enclosing namespace declaration', () => {
    const source = `
      import type { Hidden } from './internal-namespace';

      /** Public shape exposing an internal namespace member. */
      export interface Public {
        /** Visible internal namespace shape. */
        value: Hidden.Shape;
      }
    `;
    const dependencies = {
      'src/internal-namespace.ts': `
        /** @internal */
        export namespace Hidden {
          export interface Shape {
            missing: { nested: string };
            /** @internal */ implementation: boolean;
          }
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining(['Public.value.missing', 'Public.value.missing.nested']),
    );
    expect(undocumented).not.toContain('Hidden');
    expect(undocumented).not.toContain('Public.value.implementation');
    expect(declarations.find(({ name }) => name === 'Public.value.missing')).toEqual(
      expect.objectContaining({ file: 'src/internal-namespace.ts', line: 5 }),
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

  test('checks CommonJS export assignments inside handwritten ambient module declarations', () => {
    const source = `
      declare module 'openai/ambient' {
        /** Public ambient client. */
        class Client {
          missing(): void;
        }
        export = Client;
      }
    `;

    expect(missing(source)).toContain('openai/ambient.Client.missing');
  });

  test('checks imported internal CommonJS export-assignment targets across handwritten modules', () => {
    const source = `
      import Hidden = require('./internal-commonjs');
      export = Hidden;
    `;
    const dependencies = {
      'src/internal-commonjs.ts': `
        /** @internal */
        class Hidden {
          missing = { nested: true };
          static available = { nested: true };
          /** @internal */ implementation = true;
        }
        export = Hidden;
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Hidden.missing',
        'Hidden.missing.nested',
        'Hidden.static.available',
        'Hidden.static.available.nested',
      ]),
    );
    expect(undocumented).not.toContain('Hidden.implementation');
    expect(declarations.find(({ name }) => name === 'Hidden.missing')).toEqual(
      expect.objectContaining({ file: 'src/internal-commonjs.ts', line: 4 }),
    );
  });

  test('does not inspect ordinary cross-module CommonJS forwarding barrels', () => {
    const source = `
      import Client = require('./public-commonjs');
      export = Client;
    `;
    const dependencies = {
      'src/public-commonjs.ts': `
        /** Public implementation already audited in its own module. */
        class Client {
          missing = true;
        }
        export = Client;
      `,
    };

    expect(inspectSource('src/fixture.ts', source, dependencies)).toEqual([]);
  });

  test('checks handwritten internal shapes exposed through cross-file import types', () => {
    const source = `
      /** Public inline-imported shape. */
      export type Public = import('./internal-shape').Hidden;
      /** Public inline-imported internal value shape. */
      export type Value = typeof import('./internal-shape').client;
    `;
    const dependencies = {
      'src/internal-shape.ts': `
        /** @internal */
        export interface Hidden {
          missing: { nested: string };
          /** @internal */ implementation: boolean;
        }
        /** @internal */
        export const client = { missing: { nested: true } };
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.missing',
        'Public.missing.nested',
        'Value.missing',
        'Value.missing.nested',
      ]),
    );
    expect(undocumented).not.toContain('Hidden');
    expect(undocumented).not.toContain('Public.implementation');
    expect(declarations.find(({ name }) => name === 'Public.missing')).toEqual(
      expect.objectContaining({ file: 'src/internal-shape.ts', line: 4 }),
    );
  });

  test('checks public inline import type arguments without auditing the external wrapper declaration', () => {
    const source = `
      /** Public inline import with a user-provided argument. */
      export type Public = import('./wrapper').Wrapper<{ missing: string }>;
    `;
    const dependencies = {
      'src/wrapper.ts': `
        export type Wrapper<Value> = Value;
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(['Public.missing']);
    expect(declarations.map(({ name }) => name)).not.toContain('Wrapper');
  });

  test('checks handwritten internal declarations exposed through cross-module re-export aliases', () => {
    const source = `
      export { Hidden as Public } from './internal-export';
      export type { Hidden as PublicType } from './internal-export';
      export { External as Ignored } from './ordinary-barrel';
    `;
    const dependencies = {
      'src/internal-export.ts': `
        /** @internal */
        export interface Hidden {
          missing: { nested: string };
          /** @internal */ implementation: boolean;
        }
      `,
      'src/ordinary-barrel.ts': `
        export interface External {
          ignored: string;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.missing',
        'Public.missing.nested',
        'PublicType.missing',
        'PublicType.missing.nested',
      ]),
    );
    expect(undocumented).not.toContain('Hidden');
    expect(undocumented).not.toContain('Public.implementation');
    expect(undocumented).not.toContain('Ignored.ignored');
    expect(declarations.find(({ name }) => name === 'Public.missing')).toEqual(
      expect.objectContaining({ file: 'src/internal-export.ts', line: 4 }),
    );
  });

  test('terminates cyclic internal namespace aliases while preserving public visible members', () => {
    const source = `
      export { Hidden as Public } from './internal-namespace-cycle';
    `;
    const dependencies = {
      'src/internal-namespace-cycle.ts': `
        /** @internal */
        export namespace Hidden {
          export interface Shape {
            missing: string;
          }
          export import Again = Hidden;
        }
      `,
    };
    const undocumented = inspectSource('src/fixture.ts', source, dependencies)
      .filter(({ documented }) => !documented)
      .map(({ name }) => name);

    expect(undocumented).toContain('Public.Shape.missing');
    expect(undocumented.some((name) => name.includes('Again.Again'))).toBe(false);
  });

  test('checks constraints and defaults of publicly exposed internal cross-module generic types', () => {
    const source = `
      export { Hidden as Public } from './internal-generic';
    `;
    const dependencies = {
      'src/internal-generic.ts': `
        /** @internal */
        export interface Hidden<
          Value extends { missing: string } = { other: string }
        > {
          /** Public generic value. */
          value: Value;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(expect.arrayContaining(['Public.Value.missing', 'Public.Value.other']));
    expect(declarations.find(({ name }) => name === 'Public.Value.missing')).toEqual(
      expect.objectContaining({ file: 'src/internal-generic.ts', line: 4 }),
    );
  });

  test('checks imported internal runtime values exposed through cross-module type queries', () => {
    const source = `
      import { client } from './internal-value';

      /** Public shape derived from an imported internal value. */
      export type Public = typeof client;
      /** Public container of the imported value shape. */
      export interface Container {
        /** Public runtime value. */
        value: typeof client;
      }
    `;
    const dependencies = {
      'src/internal-value.ts': `
        /** @internal */
        export const client = {
          missing: { nested: true },
          /** @internal */ implementation: true,
        };
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.missing',
        'Public.missing.nested',
        'Container.value.missing',
        'Container.value.missing.nested',
      ]),
    );
    expect(undocumented).not.toContain('client');
    expect(undocumented).not.toContain('Public.implementation');
  });

  test('keeps same-named tuple elements and generic type arguments independently documented', () => {
    const source = `
      /** Internal generic two-position mapping. */
      type Pair<First, Second> = [First, Second];
      /** Public tuple with independently documented positional fields. */
      export type Tuple = [
        {
          /** Only the first position is documented. */
          shared: string;
        },
        {
          shared: string;
        },
      ];
      /** Public generic with independently documented type arguments. */
      export type Generic = Pair<
        {
          /** Only the first type argument is documented. */
          shared: string;
        },
        {
          shared: string;
        }
      >;
    `;
    const declarations = inspectSource('src/fixture.ts', source);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(expect.arrayContaining(['Tuple.shared', 'Generic.shared']));
    expect(declarations.filter(({ name }) => name === 'Tuple.shared')).toHaveLength(2);
    expect(declarations.filter(({ name }) => name === 'Generic.shared')).toHaveLength(2);
  });

  test('requires nested option and result documentation separately for every method overload', () => {
    const source = `
      /** Public overloaded client. */
      export interface Client {
        /** Sends a typed request. */
        send(options: {
          /** First overload discriminator. */
          kind: 'first';
        }): {
          /** First overload output. */
          output: 'first';
        };
        send(options: {
          kind: 'second';
        }): {
          output: 'second';
        };
      }
    `;
    const declarations = inspectSource('src/fixture.ts', source);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(['Client.send.options.kind', 'Client.send.result.output']);
    expect(declarations.filter(({ name }) => name === 'Client.send')).toHaveLength(1);
    expect(declarations.filter(({ name }) => name === 'Client.send.options.kind')).toHaveLength(2);
    expect(declarations.filter(({ name }) => name === 'Client.send.result.output')).toHaveLength(2);
  });

  test('keeps function, callable, and constructor overload fields independent without duplicating roots', () => {
    const source = `
      /** Public overloaded function. */
      export declare function send(options: {
        /** First callable discriminator. */
        kind: 'first';
      }): {
        /** First callable output. */
        output: 'first';
      };
      export declare function send(options: { kind: 'second' }): { output: 'second' };

      /** Public overloaded callable and constructor. */
      export interface Callable {
        /** First callable signature. */
        (options: { /** First callable option. */ kind: 'first' }): void;
        (options: { kind: 'second' }): void;
        /** First constructor signature. */
        new (options: { /** First constructor option. */ kind: 'first' }): Callable;
        new (options: { kind: 'second' }): Callable;
      }
    `;
    const declarations = inspectSource('src/fixture.ts', source);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'send.options.kind',
        'send.result.output',
        'Callable.[call].options.kind',
        'Callable.[new].options.kind',
      ]),
    );
    expect(declarations.filter(({ name }) => name === 'send')).toHaveLength(1);
    expect(declarations.filter(({ name }) => name === 'Callable.[call]')).toHaveLength(1);
    expect(declarations.filter(({ name }) => name === 'Callable.[new]')).toHaveLength(1);
  });

  test('requires documentation on genuine index signatures projected into public types', () => {
    const source = `
      /** Internal dictionary shape. */
      type Hidden = { [key: string]: string };
      /** Public projected dictionary. */
      export type Public = Extract<Hidden, object>;
      /** Public dictionary selected through a mapped utility. */
      export type Selected = Pick<Hidden, keyof Hidden>;
      /** Public optional mapped dictionary. */
      export type Optional = Partial<Hidden>;
      /** Public inline mapped dictionary. */
      export type Inline = { [Key in keyof Hidden]: Hidden[Key] };
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Public.[key: string]',
        'Selected.[key: string]',
        'Optional.[key: string]',
        'Inline.[key: string]',
      ]),
    );
  });

  test('maps projected handwritten call and construct signatures to their original module', () => {
    const source = `
      import type { Hidden } from './internal-callable';

      /** Public projected callable and constructor. */
      export type Public = Extract<Hidden, object>;
    `;
    const dependencies = {
      'src/internal-callable.ts': `
        /** @internal */
        export interface Hidden {
          (options: { missing: string }): { output: string };
          new (options: { missing: string }): { result: string };
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations.filter(({ documented }) => !documented).map(({ name }) => name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.[call]',
        'Public.[call].options.missing',
        'Public.[call].result.output',
        'Public.constructor',
        'Public.constructor.options.missing',
        'Public.result',
      ]),
    );
    expect(declarations.find(({ name }) => name === 'Public.[call]')).toEqual(
      expect.objectContaining({ file: 'src/internal-callable.ts', line: 4 }),
    );
    expect(declarations.find(({ name }) => name === 'Public.constructor')).toEqual(
      expect.objectContaining({ file: 'src/internal-callable.ts', line: 5 }),
    );
  });
});
