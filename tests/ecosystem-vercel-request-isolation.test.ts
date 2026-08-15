import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Runtime = 'edge' | 'node';

interface RecordedCall {
  clientID: number;
  token: string;
}

interface HandlerResult {
  body: string;
  status: number;
}

interface HandlerHarness {
  calls: RecordedCall[];
  callsPerRequest: number;
  runRequest: () => Promise<HandlerResult>;
}

interface MockNodeResponse {
  body: string;
  statusCode: number;
  status: (statusCode: number) => MockNodeResponse;
  end: (body: string) => MockNodeResponse;
}

function mockNextResponse(body: string, init: { status?: number } = {}): HandlerResult {
  return { body, status: init.status ?? 200 };
}

function createMockNodeResponse(): MockNodeResponse {
  return {
    body: '',
    statusCode: 0,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
}

function createHandlerHarness(runtime: Runtime, failedClientIDs: number[] = []): HandlerHarness {
  const calls: RecordedCall[] = [];
  const failures = new Set(failedClientIDs);
  const callsPerRequest = runtime === 'edge' ? 8 : 7;
  let nextClientID = 0;

  class MockOpenAI {
    readonly id: number;
    readonly token: string;

    constructor() {
      nextClientID += 1;
      this.id = nextClientID;
      this.token = `synthetic-token-${this.id}`;
    }
  }

  function uploadWebApiTestCases({
    client,
    it,
  }: {
    client: MockOpenAI;
    it: (description: string, handler: () => Promise<void>) => void;
  }): void {
    for (let index = 0; index < callsPerRequest; index += 1) {
      it(`mock API call ${index + 1}`, async () => {
        calls.push({ clientID: client.id, token: client.token });

        if (failures.has(client.id)) {
          throw new Error(`synthetic failure for client ${client.id}`);
        }
      });
    }
  }

  const dependencies: Record<string, unknown> = {
    '../../uploadWebApiTestCases': { uploadWebApiTestCases },
    'fastest-levenshtein': { distance: () => 0 },
    'next/server': { NextResponse: mockNextResponse },
    openai: { __esModule: true, default: MockOpenAI },
  };

  const handlerPath = path.resolve(
    process.cwd(),
    'ecosystem-tests/vercel-edge/src/pages/api',
    `${runtime}-test.ts`,
  );
  const handlerSource = readFileSync(handlerPath, 'utf-8');
  const transpiledHandler = ts.transpileModule(handlerSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: handlerPath,
  });

  const handlerExports: {
    default?: (request: unknown, response?: MockNodeResponse) => Promise<unknown>;
  } = {};

  runInNewContext(
    transpiledHandler.outputText,
    {
      console: { error: () => null },
      exports: handlerExports,
      module: { exports: handlerExports },
      require: (specifier: string) => {
        const dependency = dependencies[specifier];

        if (!dependency) {
          throw new Error(`Unexpected handler dependency: ${specifier}`);
        }

        return dependency;
      },
    },
    { filename: handlerPath },
  );

  const handler = handlerExports.default;

  if (!handler) {
    throw new Error(`Missing default handler export: ${handlerPath}`);
  }

  return {
    calls,
    callsPerRequest,
    async runRequest(): Promise<HandlerResult> {
      if (runtime === 'edge') {
        const response = (await handler({})) as HandlerResult;
        return { body: response.body, status: response.status };
      }

      const response = createMockNodeResponse();
      await handler({}, response);
      return { body: response.body, status: response.statusCode };
    },
  };
}

async function expectSuccessfulRequest(harness: HandlerHarness, clientID: number): Promise<void> {
  const previousCallCount = harness.calls.length;

  expect(await harness.runRequest()).toEqual({ body: 'Passed!', status: 200 });
  expect(harness.calls.slice(previousCallCount)).toEqual(
    Array.from({ length: harness.callsPerRequest }, () => ({
      clientID,
      token: `synthetic-token-${clientID}`,
    })),
  );
}

describe.each<Runtime>(['edge', 'node'])('warm Vercel %s handler', (runtime) => {
  test('runs only the current request client and credentials', async () => {
    const harness = createHandlerHarness(runtime);

    await expectSuccessfulRequest(harness, 1);
    await expectSuccessfulRequest(harness, 2);
    await expectSuccessfulRequest(harness, 3);

    expect(harness.calls).toHaveLength(harness.callsPerRequest * 3);
  });

  test('does not replay a failed previous request', async () => {
    const harness = createHandlerHarness(runtime, [1]);

    expect(await harness.runRequest()).toEqual({ body: 'Internal Server Error', status: 500 });
    expect(harness.calls).toEqual([{ clientID: 1, token: 'synthetic-token-1' }]);

    await expectSuccessfulRequest(harness, 2);
    await expectSuccessfulRequest(harness, 3);
  });
});
