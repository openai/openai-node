import fs from 'node:fs';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import type { FileObject } from 'openai/resources/files';
import type { FineTuningJob } from 'openai/resources/fine-tuning';

type Status = FineTuningJob['status'];
const privateErrorDetail = 'Synthetic private fine-tuning error detail';
const filename = 'examples/fine-tuning/fine-tuning.ts';
const source = ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: filename,
}).outputText;

async function executeExample(
  initialStatus: Status,
  followingStatuses: Status[],
  fileStatuses: readonly FileObject['status'][] = ['processed'],
) {
  const requests: string[] = [];
  const waits: number[] = [];
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn();
  let statusIndex = 0;
  let fileStatusIndex = 0;
  const file: FileObject = {
    id: 'file_test',
    object: 'file',
    bytes: 1,
    created_at: 0,
    filename: 'training.jsonl',
    purpose: 'fine-tune',
    status: 'uploaded',
  };
  const job = (status: Status): FineTuningJob => ({
    id: 'ftjob_test',
    object: 'fine_tuning.job',
    created_at: 0,
    error:
      status === 'failed' ? { code: 'synthetic_failure', message: privateErrorDetail, param: null } : null,
    fine_tuned_model: null,
    finished_at: null,
    hyperparameters: { n_epochs: 'auto' },
    model: 'gpt-3.5-turbo',
    organization_id: 'org_test',
    result_files: [],
    seed: 1,
    status,
    trained_tokens: null,
    training_file: file.id,
    validation_file: null,
  });
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const request = `${init?.method} ${url.pathname}`;
    requests.push(request);
    if (request === 'POST /files') {
      // Consume the real example's streaming multipart body before completing its upload.
      await new Response(init?.body).arrayBuffer();
      return Response.json(file);
    }
    if (request === 'GET /files/file_test') {
      const status = fileStatuses[fileStatusIndex];
      fileStatusIndex += 1;
      if (status === undefined) {
        throw new Error('The example polled past its terminal file status');
      }
      return Response.json({ ...file, status });
    }
    if (request === 'POST /fine_tuning/jobs') {
      return Response.json(job(initialStatus));
    }
    if (request === 'GET /fine_tuning/jobs/ftjob_test') {
      const status = followingStatuses[statusIndex];
      statusIndex += 1;
      if (status === undefined) {
        throw new Error('The example polled past its terminal status');
      }
      return Response.json(job(status));
    }
    if (request === 'GET /fine_tuning/jobs/ftjob_test/events') {
      expect(url.searchParams.get('limit')).toBe('100');
      return Response.json({ object: 'list', data: [], has_more: false });
    }
    throw new Error(`Unexpected example request: ${request}`);
  };
  class OfflineOpenAI extends OpenAI {
    constructor() {
      super({ apiKey: 'synthetic-test-key', baseURL: 'https://example.test', fetch, maxRetries: 0 });
    }
  }

  await runInNewContext(
    source,
    {
      exports: {},
      require(specifier: string) {
        if (specifier === 'openai') {
          return { __esModule: true, default: OfflineOpenAI };
        }
        if (specifier === 'node:fs') {
          return fs;
        }
        throw new Error(`Unexpected example import: ${specifier}`);
      },
      console: { log, error },
      process: { exit },
      setTimeout(callback: () => void, milliseconds: number) {
        waits.push(milliseconds);
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the VM timer callback contract without real five-second waits.
        callback();
        return 0;
      },
    },
    { filename },
  );

  return { requests, waits, log, error, exit };
}

async function runExample(initialStatus: Status, followingStatuses: Status[]) {
  const { requests, waits, log, error, exit } = await executeExample(initialStatus, followingStatuses);
  // oxlint-disable-next-line unicorn/prefer-at -- Keep indexed access compatible with the repository's ES2020 type library.
  const finalStatus = followingStatuses[followingStatuses.length - 1] ?? initialStatus;
  if (finalStatus === 'succeeded') {
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  } else {
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Fine-tuning job did not complete successfully.' }),
    );
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  }
  expect(inspect([log.mock.calls, error.mock.calls], { depth: null })).not.toContain(privateErrorDetail);
  expect(requests.filter((request) => request === 'POST /fine_tuning/jobs')).toHaveLength(1);
  expect(requests.filter((request) => request === 'GET /fine_tuning/jobs/ftjob_test')).toHaveLength(
    followingStatuses.length,
  );
  expect(requests.filter((request) => request === 'GET /fine_tuning/jobs/ftjob_test/events')).toHaveLength(
    followingStatuses.length,
  );
  expect(waits).toEqual(followingStatuses.map(() => 5000));
  for (const status of followingStatuses) {
    expect(log).toHaveBeenCalledWith(status);
  }
}

test.each([
  { name: 'first processing check', statuses: ['error'] },
  { name: 'previously uploaded file', statuses: ['uploaded', 'error'] },
] as const)('stops after a file-processing error for the $name', async ({ statuses }) => {
  const { requests, waits, error, exit } = await executeExample('succeeded', [], statuses);

  expect(requests).toEqual(['POST /files', ...statuses.map(() => 'GET /files/file_test')]);
  expect(waits).toEqual(statuses.slice(0, -1).map(() => 1000));
  expect(error).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'File processing failed for file_test' }),
  );
  expect(exit).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(1);
});

test('starts fine-tuning after an uploaded file is processed', async () => {
  const { requests, waits, error, exit } = await executeExample('succeeded', [], ['uploaded', 'processed']);

  expect(requests).toEqual([
    'POST /files',
    'GET /files/file_test',
    'GET /files/file_test',
    'POST /fine_tuning/jobs',
  ]);
  expect(waits).toEqual([1000]);
  expect(error).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

test('tracks a newly created job through file validation, queueing, and training', async () => {
  await runExample('validating_files', ['validating_files', 'queued', 'running', 'succeeded']);
});

test.each<Status>(['queued', 'running'])('continues tracking an initially %s job', async (status) => {
  await runExample(status, ['running', 'succeeded']);
});

test.each<Status>(['succeeded', 'failed', 'cancelled'])(
  'does not poll an initially %s job',
  async (status) => {
    await runExample(status, []);
  },
);

test.each(
  (['validating_files', 'queued', 'running'] as const).flatMap((initialStatus) =>
    (['failed', 'cancelled'] as const).map((status) => ({ initialStatus, status })),
  ),
)('stops when $initialStatus ends with $status', async ({ initialStatus, status }) => {
  await runExample(initialStatus, [status]);
});
