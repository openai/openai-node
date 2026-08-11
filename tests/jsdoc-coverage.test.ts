import { createRequire } from 'node:module';

interface CoverageDeclaration {
  file: string;
  line: number;
  column: number;
  kind: string;
  name: string;
  documented: boolean;
}

const loadCoverageChecker = createRequire(`${process.cwd()}/package.json`);
const { collectCoverage, inspectSource } = loadCoverageChecker('./scripts/check-jsdoc-coverage.cjs') as {
  collectCoverage: () => {
    files: number;
    declarations: CoverageDeclaration[];
    undocumented: CoverageDeclaration[];
  };
  inspectSource: (file: string, source: string) => CoverageDeclaration[];
};

function missing(source: string): string[] {
  return inspectSource('src/fixture.ts', source)
    .filter((declaration) => !declaration.documented)
    .map((declaration) => declaration.name);
}

describe('handwritten SDK JSDoc coverage', () => {
  test('requires documentation on exports, public members, options, and result fields', () => {
    const source = `
      export interface Event { value: string; }
      export type Options = { timeout: number };
      export class Client {
        state = 'ready';
        constructor(options: { token: string }) {}
        request(options: { retries: number }): { output: string } {
          return { output: '' };
        }
      }
      export function create(options: { endpoint: string }) {}
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Event',
        'Event.value',
        'Options',
        'Options.timeout',
        'Client',
        'Client.state',
        'Client.constructor',
        'Client.constructor.options.token',
        'Client.request',
        'Client.request.options.retries',
        'Client.request.result.output',
        'create',
        'create.options.endpoint',
      ]),
    );
  });

  test('follows private types exposed through public signatures and inherited event maps', () => {
    const source = `
      type Options = { timeout: number };
      type Events = { message: (value: string) => void };
      /** Public event emitter. */
      export class Client extends EventEmitter<Events> {
        /** Sends a request. */
        request(options: Options): void {}
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['Options', 'Options.timeout', 'Events', 'Events.message']),
    );
  });

  test('checks nested exported namespaces', () => {
    const source = `
      export namespace Snapshot {
        export interface Choice { message: string; }
        export namespace Details {
          export type Message = { text: string };
        }
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Snapshot',
        'Snapshot.Choice',
        'Snapshot.Choice.message',
        'Snapshot.Details',
        'Snapshot.Details.Message',
        'Snapshot.Details.Message.text',
      ]),
    );
  });

  test('checks named local exports, aliases, type exports, and namespace-local exports', () => {
    const source = `
      const missingValue = true;
      /** Documented declaration. */
      const documentedValue = true;
      const documentedSpecifier = true;
      /** Documented type. */
      interface Local {
        /** Documented member. */
        member: string;
      }
      export {
        missingValue as missingAlias,
        documentedValue as documentedAlias,
        /** Documented alias. */
        documentedSpecifier,
      };
      export type { Local as Public };
      /** Accepts the public type without counting its local alias separately. */
      export function accepts(value: Local): void {}
      /** Documented namespace. */
      export namespace Group {
        const missingNested = true;
        export { missingNested as exposed };
      }
    `;

    expect(missing(source)).toEqual(['missingAlias', 'Group.exposed']);
    expect(inspectSource('src/fixture.ts', source).map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'missingAlias',
        'documentedAlias',
        'documentedSpecifier',
        'Public',
        'Public.member',
        'accepts',
        'Group',
        'Group.exposed',
      ]),
    );
  });

  test('does not require duplicate documentation on re-export-only barrels', () => {
    const source = `
      export { value, type Shape } from './generated';
      export type { Local } from './handwritten';
      export * from './generated';
    `;

    expect(inspectSource('src/fixture.ts', source)).toEqual([]);
  });

  test('checks default exports of local declarations and expressions', () => {
    expect(missing('const value = true; export default value;')).toEqual(['default']);
    expect(missing('/** Documented value. */\nconst value = true; export default value;')).toEqual([]);
    expect(missing('const value = true;\n/** Documented default. */\nexport default value;')).toEqual([]);
    expect(missing('export default () => true;')).toEqual(['default']);
    expect(missing('/** Documented default. */\nexport default () => true;')).toEqual([]);
    expect(missing('/** Documented default. */\nexport default function create() {}')).toEqual([]);
    expect(missing('/** Documented default. */\nexport default class Client {}')).toEqual([]);
    expect(missing('/** Documented default. */\nexport default { undocumented: true };')).toEqual([
      'default.undocumented',
    ]);
  });

  test('checks each member of an exported enum', () => {
    const source = `
      /** Connection state. */
      export enum State {
        /** The connection is open. */
        Open,
        Closed,
      }
    `;

    expect(missing(source)).toEqual(['State.Closed']);
  });

  test('checks index, call, and construct signatures on interfaces and type literals', () => {
    const source = `
      /** Callable public interface. */
      export interface PublicInterface {
        [key: string]: { indexOutput: string };
        (options: { callInput: string }): { callOutput: string };
        new (options: { constructInput: string }): { constructOutput: string };
      }
      /** Callable public type literal. */
      export type PublicType = {
        [index: number]: { indexOutput: string };
        (options: { callInput: string }): { callOutput: string };
        new (options: { constructInput: string }): { constructOutput: string };
      };
    `;

    expect(missing(source)).toEqual([
      'PublicInterface.[key: string]',
      'PublicInterface.[key: string].result.indexOutput',
      'PublicInterface.[call]',
      'PublicInterface.[call].options.callInput',
      'PublicInterface.[call].result.callOutput',
      'PublicInterface.[new]',
      'PublicInterface.[new].options.constructInput',
      'PublicInterface.[new].result.constructOutput',
      'PublicType.[index: number]',
      'PublicType.[index: number].result.indexOutput',
      'PublicType.[call]',
      'PublicType.[call].options.callInput',
      'PublicType.[call].result.callOutput',
      'PublicType.[new]',
      'PublicType.[new].options.constructInput',
      'PublicType.[new].result.constructOutput',
    ]);
  });

  test('checks inferred object properties and signatures of exported function values', () => {
    const source = `
      type Options = { timeout: number };
      /** Connection states. */
      export const State = {
        OPEN: 1,
        nested: { CLOSED: 3 },
      } as const;
      /** Performs a request. */
      export const request = (options: Options): { output: string } => ({ output: '' });
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'State.OPEN',
        'State.nested',
        'State.nested.CLOSED',
        'Options',
        'Options.timeout',
        'request.result.output',
      ]),
    );
  });

  test('checks class expressions and public constructor parameter properties', () => {
    const source = `
      /** Public client. */
      export const Client = class {
        /**
         * Creates the client.
         * @param documented A documented public property.
         */
        constructor(
          public missing: string,
          public documented: string,
          /** A documented readonly property. */ readonly readonlyValue: string,
          ordinary: string,
        ) {}
        undocumented() {}
      };
      /** Public named class. */
      export class Visibility {
        /** Creates a client without exposing these parameter properties. */
        constructor(private secret: string, protected hidden: string) {}
      }
    `;

    expect(missing(source)).toEqual([
      'Client.constructor',
      'Client.missing',
      'Client.documented',
      'Client.undocumented',
    ]);
  });

  test('resolves namespace-local private types within their lexical scopes', () => {
    const source = `
      type Options = { outer: string };
      /** Uses the outer options. */
      export function outer(options: Options): void {}
      /** Public namespace. */
      export namespace Group {
        type Options = { nested: string };
        /** Uses the namespace options. */
        export function nested(options: Options): void {}
        /** Nested public namespace. */
        export namespace Child {
          type Options = { child: string };
          /** Uses the child options. */
          export function nested(options: Options): void {}
        }
      }
    `;

    expect(missing(source)).toEqual([
      'Options',
      'Options.outer',
      'Group.Options',
      'Group.Options.nested',
      'Group.Child.Options',
      'Group.Child.Options.child',
    ]);
  });

  test('checks exported identifiers from nested object and array binding patterns', () => {
    const source = `
      // Undocumented local destructured bindings remain undocumented in declaration emit.
      const { value: renamed, nested: { nested }, list: [first, , third] } = source;
      export {
        renamed,
        /** Documented exported alias. */ nested as documented,
        first,
        third,
      };
      /** Variable-statement documentation survives on this directly exported binding. */
      export const { direct } = source;
    `;

    expect(missing(source)).toEqual(['renamed', 'first', 'third']);
  });

  test('resolves object spread properties, their documentation, and overwrite order', () => {
    const source = `
      const base = {
        /** Inherited documented property. */
        documented: true,
        undocumented: true,
        /** Documentation removed by a later override. */
        overridden: true,
      };
      const intermediate = {
        ...base,
        /** Documented through a nested spread. */
        nested: true,
      };
      /** Exported object. */
      export const Surface = {
        ...intermediate,
        overridden: false,
      };
    `;

    expect(missing(source)).toEqual(['Surface.overridden', 'Surface.undocumented']);
  });

  test('enforces inferred public return and class-property object surfaces', () => {
    const source = `
      /** Creates a public value. */
      export function create() {
        return { undocumented: true, callback: (options: { missing: string }) => options };
      }
      /** Public client. */
      export class Client {
        /** Public configuration. */
        config = { undocumented: true };
        /** Public callback. */
        callback = (options: { missing: string }) => ({ result: true });
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'create.result.undocumented',
        'create.result.callback',
        'create.result.callback.options.missing',
        'Client.config.undocumented',
        'Client.callback.options.missing',
        'Client.callback.result.result',
      ]),
    );
  });

  test('distinguishes static and instance members with identical names', () => {
    const source = `
      /** Public client. */
      export class Client {
        /** Documented instance member. */
        value = true;
        static value = true;
      }
    `;

    expect(missing(source)).toEqual(['Client.static.value']);
  });

  test('enforces non-exported base classes, interfaces, enum values, and class types', () => {
    const source = `
      class Base { method() {} }
      interface Shape { property: string }
      enum Status { Pending }
      class Hidden { member = true }
      /** Public client. */
      export class Client extends Base implements Shape {
        /** Implemented property. */
        property = '';
        /** Uses public helper types. */
        use(status: Status, hidden: Hidden): void {}
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining([
        'Base',
        'Base.method',
        'Shape',
        'Shape.property',
        'Status',
        'Status.Pending',
        'Hidden',
        'Hidden.member',
      ]),
    );
  });

  test('enforces class index signatures, interface accessors, and override parameter properties', () => {
    const source = `
      /** Public indexed client. */
      export class Indexed {
        [key: string]: unknown;
      }
      /** Public accessor contract. */
      export interface Accessors {
        get value(): string;
        set value(next: string);
      }
      /** Public base. */
      export class Base {
        /** Base value. */
        value = '';
      }
      /** Public derived class. */
      export class Derived extends Base {
        /** Creates an instance. */
        constructor(override value: string) {
          super();
        }
      }
    `;

    expect(missing(source)).toEqual(
      expect.arrayContaining(['Indexed.[key: string]', 'Accessors.value', 'Derived.value']),
    );
  });

  test('enforces properties introduced through typed object spreads', () => {
    const source = `
      interface Shape { missing: string }
      declare const typed: Shape;
      /** Public object. */
      export const value = { ...typed };
    `;

    expect(missing(source)).toEqual(expect.arrayContaining(['value.missing']));
  });

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

  test('accepts documentation on any overload and excludes nonpublic details', () => {
    const source = `
      /** Creates a request. */
      export function create(value: string): string;
      export function create(value: number): string;
      export function create(value: string | number): string {
        return String(value);
      }
      /** Public client. */
      export class Client {
        private secret = '';
        protected helper() {}
        #hidden = '';
        /** @internal */ implementation = '';
        /** Sends a request. */
        request(options: {
          /** Number of retries. */ retries: number;
          /** @internal */ diagnostic: string;
        }) {}
      }
    `;

    expect(missing(source)).toEqual([]);
  });

  test('rejects empty comments and tags that provide no user-visible explanation', () => {
    const source = `
      /** */
      export const empty = true;
      /** @deprecated */
      export const deprecated = true;
    `;

    expect(missing(source)).toEqual(['empty', 'deprecated']);
  });

  test('excludes generated and vendored source from repository-wide coverage', () => {
    const coverage = collectCoverage();

    expect(coverage.files).toBeGreaterThan(0);
    expect(coverage.declarations).not.toEqual([]);
    expect(coverage.declarations.some(({ file }) => file === 'src/client.ts')).toBe(false);
    expect(coverage.declarations.some(({ file }) => file.startsWith('src/_vendor/'))).toBe(false);
    expect(coverage.declarations.some(({ file }) => file.startsWith('src/internal/qs/'))).toBe(false);
    expect(coverage.undocumented).toEqual([]);
  });
});
