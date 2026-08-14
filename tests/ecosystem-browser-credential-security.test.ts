import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import typescript from 'typescript';

const syntheticApiKey = 'sk-synthetic-browser-credential-security-marker';
const apiKeyProperty = '__OPENAI_ECOSYSTEM_TEST_API_KEY__';

const browserSuites = [
  {
    name: 'browser-direct-import',
    driver: 'ecosystem-tests/browser-direct-import/src/test.ts',
    fixture: 'ecosystem-tests/browser-direct-import/public/index.js',
    origin: 'http://localhost:8081',
  },
  {
    name: 'ts-browser-webpack',
    driver: 'ecosystem-tests/ts-browser-webpack/src/test.ts',
    fixture: 'ecosystem-tests/ts-browser-webpack/src/index.ts',
    origin: 'http://localhost:8080',
  },
];

interface Preload {
  callback: (key: string, origin: string) => void;
  arguments: [string, string];
}

interface DriverRun {
  actions: string[];
  logs: string[];
  navigationUrls: string[];
  preloads: Preload[];
}

function transpile(source: string): string {
  return typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
  }).outputText;
}

async function runDriver(driverPath: string): Promise<DriverRun> {
  const actions: string[] = [];
  const logs: string[] = [];
  const navigationUrls: string[] = [];
  const preloads: Preload[] = [];
  const handlers = new Map<string, (event: any) => void>();

  const page = {
    on(event: string, handler: (event: any) => void) {
      handlers.set(event, handler);
      return this;
    },
    async evaluateOnNewDocument(evaluateScript: Preload['callback'], ...args: Preload['arguments']) {
      actions.push('preload');
      preloads.push({ callback: evaluateScript, arguments: args });
    },
    async goto(url: string) {
      actions.push('navigate');
      navigationUrls.push(url);
      handlers.get('response')?.({ status: () => 200, url: () => url });
      handlers.get('requestfailed')?.({
        failure: () => ({ errorText: 'synthetic failure' }),
        url: () => url,
      });
    },
    async waitForSelector() {},
    async $(selector: string) {
      return selector === '#running' ? null : { textContent: '[]' };
    },
    async evaluate(
      evaluateElement: (element: { textContent: string }) => unknown,
      element: { textContent: string },
    ) {
      return evaluateElement(element);
    },
  };

  const browser = { newPage: async () => page, close: async () => {} };
  const driver = readFileSync(path.join(process.cwd(), driverPath), 'utf-8');

  await runInNewContext(transpile(driver), {
    exports: {},
    require: () => ({ launch: async () => browser }),
    process: { env: { OPENAI_API_KEY: syntheticApiKey } },
    console: { error: (...values: unknown[]) => logs.push(values.join(' ')), log: () => {} },
    setTimeout,
  });

  return { actions, logs, navigationUrls, preloads };
}

function createDocument(preload: Preload, origin: string, search = ''): Record<string, any> {
  const document = { location: { origin, search }, preloadArguments: preload.arguments };
  runInNewContext(`(${String(preload.callback)})(...preloadArguments)`, document);
  return document;
}

function runFixture(fixturePath: string, document: Record<string, any>): unknown {
  let receivedApiKey: unknown;

  function MockOpenAI(this: object, options: { apiKey?: string }) {
    receivedApiKey = options.apiKey;
  }

  document['exports'] = {};
  document['URLSearchParams'] = URLSearchParams;
  document['require'] = (specifier: string) => {
    if (specifier.includes('fastest-levenshtein')) {
      return { distance: () => 0 };
    }
    if (specifier === 'openai/providers/bedrock') {
      return { bedrock: () => ({}) };
    }
    return { __esModule: true, default: MockOpenAI, toFile: () => null };
  };

  const fixture = readFileSync(path.join(process.cwd(), fixturePath), 'utf-8');
  runInNewContext(transpile(fixture.replace(/runTests\(\);\s*$/u, '')), document);
  return receivedApiKey;
}

describe.each(browserSuites)('$name browser credential security', ({ driver, fixture, origin }) => {
  let run: DriverRun;

  beforeEach(async () => {
    run = await runDriver(driver);
  });

  test('does not disclose credentials in successful navigation response logs', () => {
    const responseLog = run.logs.find((line) => line.startsWith('response'));

    expect(responseLog).toContain(`${origin}/index.html`);
    expect(responseLog).not.toContain(syntheticApiKey);
  });

  test('does not disclose credentials in failed navigation request logs', () => {
    const requestLog = run.logs.find((line) => line.startsWith('requestfailed'));

    expect(requestLog).toContain(`${origin}/index.html`);
    expect(requestLog).not.toContain(syntheticApiKey);
  });

  test('preloads credentials only into exact-origin documents before a clean navigation', () => {
    expect(run.actions).toEqual(['preload', 'navigate']);
    expect(run.navigationUrls).toEqual([`${origin}/index.html`]);
    expect(run.preloads).toHaveLength(1);
    expect(run.logs.join('\n')).not.toContain(syntheticApiKey);

    const [preload] = run.preloads;
    if (!preload) {
      throw new Error('missing browser document preload');
    }
    expect(preload.arguments).toEqual([syntheticApiKey, origin]);

    const sameOriginDocument = createDocument(preload, origin);
    expect(Object.getOwnPropertyDescriptor(sameOriginDocument, apiKeyProperty)).toEqual({
      value: syntheticApiKey,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    expect(Object.keys(sameOriginDocument)).not.toContain(apiKeyProperty);
    expect(sameOriginDocument['location'].search).toBe('');
    expect(runFixture(fixture, sameOriginDocument)).toBe(syntheticApiKey);

    const reloadedDocument = createDocument(preload, origin);
    expect(runFixture(fixture, reloadedDocument)).toBe(syntheticApiKey);

    const poisonedDocument = createDocument(preload, origin, '?apiKey=attacker-controlled');
    expect(runFixture(fixture, poisonedDocument)).toBe(syntheticApiKey);

    for (const foreignOrigin of [
      'https://untrusted.example',
      'http://localhost:8099',
      origin.replace('localhost', 'localhost.attacker.invalid'),
    ]) {
      expect(
        Object.getOwnPropertyDescriptor(createDocument(preload, foreignOrigin), apiKeyProperty),
      ).toBeUndefined();
    }
  });
});
