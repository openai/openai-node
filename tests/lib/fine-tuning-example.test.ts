import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { vi } from 'vitest';
import OpenAI from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';
import type { FileObject } from 'openai/resources/files';
import type { FineTuningJob } from 'openai/resources/fine-tuning';

type Status = FineTuningJob['status'];
const filename = 'examples/fine-tuning/fine-tuning.ts';
const source = ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: filename,
}).outputText;

async function runExample(initialStatus: Status, followingStatuses: Status[]) {
  const requests: string[] = [];
  const waits: number[] = [];
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn();
  let statusIndex = 0;
  const file: FileObject = {
    id: 'file_test',
    object: 'file',
    bytes: 1,
    created_at: 0,
    filename: 'training.jsonl',
    purpose: 'fine-tune',
    status: 'processed',
  };
  const job = (status: Status): FineTuningJob => ({
    id: 'ftjob_test',
    object: 'fine_tuning.job',
    created_at: 0,
    error: null,
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
      return Response.json(file);
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

  expect(error).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
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

test.each<Status>(['failed', 'cancelled'])('stops when validation ends with %s', async (status) => {
  await runExample('validating_files', [status]);
});
