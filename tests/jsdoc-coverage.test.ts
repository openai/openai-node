import { createRequire } from 'node:module';

interface CoverageDeclaration {
  file: string;
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
