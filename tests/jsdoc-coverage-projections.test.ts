import { inspectSource, missing } from './helpers/jsdoc-coverage';

describe('resolved handwritten SDK JSDoc projections', () => {
  test('follows type queries to their local value properties and nested aliases', () => {
    const source = `
      const privateValue = {
        undocumented: true,
        nested: { missing: true },
      };
      /** Exported value using the private object's public shape. */
      export const value: typeof privateValue = privateValue;
      /** Exported alias of the same private object. */
      export type Value = typeof privateValue;
      /** Exported nested object query. */
      export type Nested = typeof privateValue.nested;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'value.undocumented',
        'value.nested',
        'value.nested.missing',
        'Value.undocumented',
        'Value.nested',
        'Value.nested.missing',
        'Nested.missing',
      ]),
    );
  });

  test('inspects only properties exposed by instantiated Pick and Omit types', () => {
    const source = `
      /** Selects a documented subset of properties. */
      type Pick<T, K extends keyof T> = { [P in K]: T[P] };
      /** Removes the documented subset of properties. */
      type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
      /** Excludes selected union members. */
      type Exclude<T, U> = T extends U ? never : T;
      /** Internal implementation shape. */
      interface Shape {
        /** The public property. */
        visible: string;
        hidden: string;
      }
      /** The selected public shape. */
      export type Picked = Pick<Shape, 'visible'>;
      /** The public shape with private details omitted. */
      export type Omitted = Omit<Shape, 'hidden'>;
    `;

    expect(missing(source)).toEqual([]);
  });

  test('inspects only members exposed through indexed-access type aliases', () => {
    const source = `
      /** Internal implementation shape. */
      interface Shape {
        /** The publicly selected nested value. */
        visible: {
          /** The public nested property. */
          included: string;
          hidden: string;
        };
        omitted: string;
      }
      /** The selected public nested property. */
      export type Public = Shape['visible']['included'];
    `;

    expect(missing(source)).toEqual([]);
  });

  test('resolves built-in Pick and Omit while checking only selected public members', () => {
    const source = `
      /** Internal implementation shape. */
      interface Shape {
        selected: string;
        hidden: string;
      }
      /** The explicitly selected public property. */
      export type Picked = Pick<Shape, 'selected'>;
      /** The same public property after hiding internal details. */
      export type Omitted = Omit<Shape, 'hidden'>;
      /** The selected public property made optional. */
      export type Optional = Partial<Pick<Shape, 'selected'>>;
      /** The selected public property made readonly. */
      export type Immutable = Readonly<Pick<Shape, 'selected'>>;
    `;

    expect(missing(source)).toEqual([
      'Picked.selected',
      'Omitted.selected',
      'Optional.selected',
      'Immutable.selected',
    ]);
  });

  test('checks the selected object returned by indexed access without inspecting omitted peers', () => {
    const source = `
      /** Internal implementation shape. */
      interface Shape {
        /** The selected public object. */
        selected: { missing: string };
        omitted: string;
      }
      /** Only the selected object is public. */
      export type Public = Shape['selected'];
    `;

    expect(missing(source)).toEqual(['Public.missing']);
  });

  test('checks all object branches returned by indexed-access unions', () => {
    const source = `
      /** Internal implementation shape. */
      interface Shape {
        /** The selected public union. */
        selected: { first: string } | { second: number };
        omitted: string;
      }
      /** Only the selected union is public. */
      export type Public = Shape['selected'];
    `;

    expect(missing(source)).toEqual(['Public.first', 'Public.second']);
  });

  test('projects utility types in public interface heritage clauses', () => {
    const source = `
      /** Internal implementation shape. */
      interface Shape {
        selected: string;
        hidden: string;
      }
      /** Public projected inheritance. */
      export interface Public extends Pick<Shape, 'selected'> {}
    `;

    expect(missing(source)).toEqual(['Public.selected']);
  });

  test('projects conditional Extract and Exclude without checking discarded union branches', () => {
    const source = `
      /** Internal discriminated union. */
      type Shape =
        | {
            /** Discriminator selecting the public branch. */
            kind: 'selected';
            included: string;
          }
        | {
            /** Discriminator selecting the internal branch. */
            kind: 'hidden';
            omitted: string;
          };
      /** The explicitly selected public branch. */
      export type Extracted = Extract<Shape, { kind: 'selected' }>;
      /** The public branch after excluding internal details. */
      export type Excluded = Exclude<Shape, { kind: 'hidden' }>;
    `;

    expect(missing(source)).toEqual(['Extracted.included', 'Excluded.included']);
  });

  test('follows function and class value surfaces exposed through type queries', () => {
    const source = `
      /** Private callable implementation. */
      function implementation(options: { missing: string }): { output: string } {
        return { output: options.missing };
      }
      /** Private base class. */
      class Base {
        static staticMissing = { nested: true };
        /** Creates the private base. */
        constructor(options: { missing: string }) {}
        inherited(): void {}
      }
      /** Public callable value. */
      export const callable: typeof implementation = implementation;
      /** Public constructor value. */
      export const Client: typeof Base = Base;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'callable.options.missing',
        'callable.result.output',
        'Client.constructor.options.missing',
        'Client.static.staticMissing',
        'Client.static.staticMissing.nested',
        'Client.inherited',
      ]),
    );
  });

  test('checks synthetic Record keys and their instantiated nested value types', () => {
    const source = `
      /** Public keyed object. */
      export type Public = Record<'selected' | 'alternate', { missing: string }>;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Public.selected',
        'Public.selected.missing',
        'Public.alternate',
        'Public.alternate.missing',
      ]),
    );
  });

  test('checks nested values behind mapped string, number, and symbol index signatures', () => {
    const source = `
      /** Public values indexed by strings. */
      export type StringValues = Record<string, { timeout: number }>;
      /** Public values indexed by numbers. */
      export type NumberValues = Record<number, { port: number }>;
      /** Public values indexed by symbols. */
      export type SymbolValues = Record<symbol, { token: string }>;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'StringValues.[key: string].timeout',
        'NumberValues.[key: number].port',
        'SymbolValues.[key: symbol].token',
      ]),
    );
  });

  test('checks generic mapped dictionaries and named values behind open Record indexes', () => {
    const source = `
      /** Named dictionary value. */
      interface Hidden {
        missing: string;
      }
      /** Public dictionary with an unresolved generic key space. */
      export type Generic<Key extends PropertyKey> = {
        [Current in Key]: { missing: string };
      };
      /** Private generic dictionary template. */
      type Template<Key extends string> = {
        [Current in Key]: { missing: string };
      };
      /** Public projection of a private generic dictionary. */
      export type Projected<Key extends string> = Template<Key>;
      /** Public generic Record with an inline dictionary value. */
      export type GenericRecord<Key extends PropertyKey> = Record<Key, { missing: string }>;
      /** Public generic Record with a named dictionary value. */
      export type NamedGenericRecord<Key extends string> = Record<Key, Hidden>;
      /** Public open dictionary with a named value. */
      export type Named = Record<string, Hidden>;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Generic.[key: Key].missing',
        'Projected.[key: Key].missing',
        'GenericRecord.[key: Key].missing',
        'NamedGenericRecord.[key: Key].missing',
        'Named.[key: string].missing',
      ]),
    );
  });

  test('does not require dictionary value documentation when its key space is empty', () => {
    const source = `
      /** Public dictionary without any possible keys. */
      export type EmptyRecord = Record<never, { missing: string }>;
      /** Public mapped dictionary without any possible keys. */
      export type EmptyMapped = { [Key in never]: { missing: string } };
      /** Public generic dictionary whose keys can never exist. */
      export type EmptyGeneric<Key extends never> = Record<Key, { missing: string }>;
    `;

    expect(missing(source)).toEqual([]);
  });

  test('checks synthetic public properties from direct finite mapped types', () => {
    const source = `
      /** Public finite mapped object. */
      export type Public = { [Key in 'first' | 'second']: { missing: string } };
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Public.first',
        'Public.first.missing',
        'Public.second',
        'Public.second.missing',
      ]),
    );
  });

  test('does not classify standard array prototype members as synthetic SDK properties', () => {
    const source = `
      /** Public array-preserving transformation. */
      export type Public<Values extends readonly unknown[]> = {
        [Index in keyof Values]: Values[Index];
      };
    `;

    expect(inspectSource('src/fixture.ts', source).map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['Public.length', 'Public.map', 'Public.reduce']),
    );
  });

  test('keeps documentation independent across distinct union branches', () => {
    const source = `
      /** Public discriminated value. */
      export type Public =
        | {
            /** Documented on only this branch. */
            shared: string;
          }
        | {
            shared: string;
          };
    `;

    expect(missing(source)).toEqual(['Public.shared']);
  });

  test('checks tuple elements produced by Parameters and ConstructorParameters', () => {
    const source = `
      /** Callable implementation. */
      function implementation(options: { missing: string }): void {}
      /** Constructor implementation. */
      class Client {
        /** Constructs the client. */
        constructor(options: { missing: string }) {}
      }
      /** Public callable parameter tuple. */
      export type Arguments = Parameters<typeof implementation>;
      /** Public constructor parameter tuple. */
      export type ConstructorArguments = ConstructorParameters<typeof Client>;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['Arguments.0.missing', 'ConstructorArguments.0.missing']),
    );
  });

  test('checks array elements exposed through projected returns, indexed access, and rest tuples', () => {
    const source = `
      /** Internal callable implementation. */
      function create(): { missing: string }[] {
        return [];
      }
      /** Internal object shape. */
      interface Shape {
        /** Public list of objects. */
        items: { missing: string }[];
      }
      /** Internal rest implementation. */
      function accepts(...items: { missing: string }[]): void {}
      /** Public returned elements. */
      export type Returned = ReturnType<typeof create>;
      /** Public indexed elements. */
      export type Indexed = Shape['items'];
      /** Public rest elements. */
      export type Arguments = Parameters<typeof accepts>;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Returned.[key: number].missing',
        'Indexed.[key: number].missing',
        'Arguments.[key: number].missing',
      ]),
    );
  });

  test('requires documentation on callable signatures preserved by projected public types', () => {
    const source = `
      /** Callable implementation type. */
      type Callable = {
        (options: { missing: string }): { output: string };
      };
      /** Public callable projection. */
      export type Public = Extract<Callable, (...args: any[]) => unknown>;
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Public.[call]',
        'Public.[call].options.missing',
        'Public.[call].result.output',
      ]),
    );
  });

  test('inspects the target of CommonJS export assignments', () => {
    const source = `
      /** Public CommonJS client. */
      class Client {
        missing(): void {}
      }
      export = Client;
    `;

    expect(missing(source)).toEqual(['Client.missing']);
  });

  test('terminates recursive public type traversal without hiding sibling members', () => {
    const source = `
      /** Recursive implementation shape. */
      interface Recursive {
        /** Recursive successor. */
        next?: Recursive;
        missing: string;
      }
      /** Public recursive projection. */
      export type Public = Partial<Recursive>;
    `;

    expect(missing(source)).toEqual(expect.arrayContaining(['Public.missing']));
  });

  test('does not inspect original property values replaced by mapped transformations', () => {
    const source = `
      /** Internal implementation shape. */
      interface Shape {
        /** Property whose public value becomes a string. */
        nested: { hidden: string };
      }
      /** Converts every property value to a string. */
      type ToStrings<T> = { [K in keyof T]: string };
      /** Public transformed shape. */
      export type Public = ToStrings<Shape>;
    `;

    expect(missing(source)).toEqual([]);
  });

  test('terminates recursive value queries and conditional projections', () => {
    const source = `
      /** Recursive implementation shape. */
      interface Recursive {
        /** Recursive successor. */
        next?: Recursive;
        missing: string;
      }
      declare const recursive: Recursive;
      /** Public recursive value. */
      export const value: typeof recursive = recursive;
      /** Public recursive conditional shape. */
      export type Conditional = Extract<Recursive, { missing: string }>;
    `;

    expect(missing(source)).toEqual(expect.arrayContaining(['value.missing', 'Conditional.missing']));
  });

  test('checks inherited instance and static members from local class expressions', () => {
    const source = `
      const LocalBase = class {
        inherited = { missing: true };
        static inheritedStatic = { missing: true };
      };
      /** Public derived client. */
      export class Public extends LocalBase {}
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Public.inherited',
        'Public.inherited.missing',
        'Public.static.inheritedStatic',
        'Public.static.inheritedStatic.missing',
      ]),
    );
  });

  test('checks undocumented members inherited through local mixin expressions', () => {
    const source = `
      /** Public base constructor. */
      class Base {}
      /** Adds inherited public functionality. */
      function mixin<T extends new (...args: any[]) => object>(base: T) {
        return class extends base {
          inherited = { missing: true };
        };
      }
      /** Public mixed-in class. */
      export class Public extends mixin(Base) {}
    `;

    expect(missing(source)).toEqual(expect.arrayContaining(['Public.inherited', 'Public.inherited.missing']));
  });

  test('checks public members inherited from internal handwritten declarations in another module', () => {
    const source = `
      import { InternalBase } from './internal-base';

      /** Public derived client. */
      export class Public extends InternalBase {}
    `;
    const dependencies = {
      'src/internal-base.ts': `
        /** @internal */
        export class InternalBase {
          inherited = { missing: true };
          static inheritedStatic = { missing: true };
          private secret = true;
          protected hidden = true;
          /** @internal */ implementation = true;
        }
      `,
    };
    const declarations = inspectSource('src/fixture.ts', source, dependencies);
    const undocumented = declarations
      .filter((declaration) => !declaration.documented)
      .map((declaration) => declaration.name);

    expect(undocumented).toEqual(
      expect.arrayContaining([
        'Public.inherited',
        'Public.inherited.missing',
        'Public.static.inheritedStatic',
        'Public.static.inheritedStatic.missing',
      ]),
    );
    expect(undocumented).not.toEqual(
      expect.arrayContaining(['InternalBase', 'Public.secret', 'Public.hidden']),
    );
    expect(declarations.find(({ name }) => name === 'Public.inherited')).toEqual(
      expect.objectContaining({ file: 'src/internal-base.ts', line: 4 }),
    );
    expect(declarations.find(({ name }) => name === 'Public.static.inheritedStatic')).toEqual(
      expect.objectContaining({ file: 'src/internal-base.ts', line: 5 }),
    );
  });

  test('reports undocumented declaration coordinates in the original source file', () => {
    const source = [
      "import type { IncomingMessage } from 'node:http';",
      '',
      'function implementation(value: IncomingMessage | undefined): void {',
      '  if (value) {',
      '    value.destroy();',
      '  }',
      '}',
      '',
      '/** Public API. */',
      'export interface Public {',
      '  undocumented: string;',
      '}',
    ].join('\n');

    expect(
      inspectSource('src/fixture.ts', source).find(({ name }) => name === 'Public.undocumented'),
    ).toEqual(expect.objectContaining({ file: 'src/fixture.ts', line: 11, column: 3, documented: false }));
  });

  test('maps inferred declaration members to their original compiler symbol locations', () => {
    const source = [
      'function hidden(): number {',
      '  return 1;',
      '}',
      '',
      '/** Creates a public value. */',
      'export function create() {',
      '  return {',
      '    missing: true,',
      '  };',
      '}',
    ].join('\n');

    expect(
      inspectSource('src/fixture.ts', source).find(({ name }) => name === 'create.result.missing'),
    ).toEqual(expect.objectContaining({ line: 8, column: 5, documented: false }));
  });
});
