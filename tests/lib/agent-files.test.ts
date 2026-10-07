import * as fsPromises from 'node:fs/promises';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import OpenAI, { APIError } from 'openai';
import { AgentFileUploadError } from 'openai/lib/beta/agents/files';
import { AgentTurnResult } from 'openai/lib/beta/agents/agent-turn-result';
import {
  agentFile,
  agentFileDestination,
  prepareAgentDirectory,
} from 'openai/helpers/beta/agents/filesystem';
import type { Turn } from 'openai/resources/beta/agents/sessions/turns';

// oxlint-disable-next-line anti-slop/no-module-mocking -- Keep real filesystem I/O while deterministically testing an identity change during path resolution.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, realpath: vi.fn(actual.realpath), lstat: vi.fn(actual.lstat) };
});

function fileTransport({
  failUpload = 0,
  failStage = false,
  defaultKey,
  uploadedSizes,
}: {
  failUpload?: number;
  failStage?: boolean;
  defaultKey?: string;
  uploadedSizes?: number[];
} = {}) {
  const requests: Request[] = [];
  const uploaded: string[] = [];
  const staged: unknown[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    maxRetries: 0,
    defaultHeaders: defaultKey ? { 'Idempotency-Key': defaultKey } : undefined,
    fetch: async (url, init) => {
      if (String(url) === 'data:,') {
        return new Response('');
      }
      const request = new Request(url, init);
      requests.push(request);
      if (new URL(request.url).pathname === '/v1/files') {
        const data = await request.formData();
        const value = data.get('file');
        if (!value || typeof value === 'string') {
          throw new Error('Missing upload');
        }
        uploaded.push(await value.text());
        expect(data.get('purpose')).toBe('user_data');
        if (uploaded.length === failUpload) {
          return Response.json({ error: { message: 'Synthetic upload failure' } }, { status: 400 });
        }
        return Response.json({
          id: `file_${uploaded.length}`,
          object: 'file',
          filename: value.name,
          bytes: uploadedSizes?.[uploaded.length - 1] ?? value.size,
          purpose: 'user_data',
        });
      }
      const body = await request.json();
      if (!body || typeof body !== 'object' || !('path' in body)) {
        throw new Error('Missing stage path');
      }
      staged.push(body);
      if (failStage) {
        return Response.json({ error: { message: 'Synthetic stage failure' } }, { status: 400 });
      }
      return Response.json({
        object: 'agent.environment.file',
        environment_id: 'env_test',
        path: body.path,
        size_bytes: 1,
      });
    },
  });
  return { client, requests, uploaded, staged };
}

const turn: Turn = {
  id: 'turn_test',
  session_id: 'session_test',
  agent_id: 'agent_test',
  object: 'agent.session.turn',
  status: 'completed',
  subagent_id: null,
  created_at: 1,
  started_at: 1,
  completed_at: 2,
  error: null,
  usage: null,
};
const artifact = {
  id: 'artifact_exact',
  object: 'agent.session.artifact',
  session_id: turn.session_id,
  turn_id: turn.id,
  path: '/workspace/outputs/report.md',
  size_bytes: 6,
  created_at: 2,
  environment_id: 'env_test',
};
function artifactTransport(mode: 'found' | 'missing' | 'ambiguous' = 'found') {
  const requests: Request[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    maxRetries: 0,
    fetch: async (url, init) => {
      const req = new Request(url, init);
      requests.push(req);
      const parsed = new URL(req.url);
      if (parsed.pathname.endsWith('/content')) {
        expect(parsed.pathname).toContain('/artifact_exact/content');
        let index = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (index < 2) {
                controller.enqueue(new TextEncoder().encode(index === 0 ? 'one' : 'two'));
                index += 1;
              } else {
                controller.close();
              }
            },
          }),
        );
      }
      if (!parsed.searchParams.has('after')) {
        return Response.json({
          object: 'list',
          data: [{ ...artifact, id: 'artifact_old', turn_id: 'turn_old' }],
          has_more: true,
          last_id: 'artifact_old',
        });
      }
      let data = [artifact];
      if (mode === 'missing') {
        data = [];
      }
      if (mode === 'ambiguous') {
        data.push({ ...artifact, id: 'artifact_duplicate' });
      }
      return Response.json({ object: 'list', data, has_more: false });
    },
  });
  return { client, requests };
}

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(nodePath.join(tmpdir(), 'agent-files-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('beta agent file preparation', () => {
  test('prepares ordinary Files inputs and exposes owned uploads', async () => {
    const { client, requests, uploaded } = fileTransport();
    const prepared = await client.beta.agents.environments.files.prepare(
      { '/workspace/a.txt': new File(['a'], 'a.txt'), '/workspace/b.txt': new File(['b'], 'b.txt') },
      { headers: { 'X-Trace-Test': 'kept' } },
    );
    expect(prepared.files).toEqual([
      { type: 'file_id', file_id: 'file_1', path: '/workspace/a.txt' },
      { type: 'file_id', file_id: 'file_2', path: '/workspace/b.txt' },
    ]);
    expect(prepared.uploadedFiles.map((file) => file.id)).toEqual(['file_1', 'file_2']);
    expect(uploaded).toEqual(['a', 'b']);
    expect(requests.every((req) => req.headers.get('x-trace-test') === 'kept')).toBe(true);
  });
  test.each([
    '/etc/secret',
    '/workspace/../secret',
    '/workspace/a//b',
    '/workspace/.codex/config',
    '/workspace/outputs',
  ])('rejects invalid destination before uploading: %s', async (path) => {
    const { client, requests } = fileTransport();
    await expect(
      client.beta.agents.environments.files.prepare({ [path]: new File(['a'], 'a') }),
    ).rejects.toThrow('absolute file path');
    expect(requests).toHaveLength(0);
  });
  test('rejects shared retry keys before uploading', async () => {
    const { client, requests } = fileTransport();
    const file = new File(['a'], 'a');
    const prepare = client.beta.agents.environments.files.prepare.bind(client.beta.agents.environments.files);
    await expect(
      prepare({ '/workspace/a': file, '/workspace/b': file }, { headers: { 'IDEMPOTENCY-KEY': 'same' } }),
    ).rejects.toThrow('Idempotency-Key');
    expect(requests).toHaveLength(0);
  });
  test.each([
    ['/workspace/a', '/workspace/a-b', '/workspace/a/b'],
    ['/workspace/a/b', '/workspace/a-b', '/workspace/a'],
  ])('rejects ancestor collisions before uploading: %j', async (...paths) => {
    const { client, requests } = fileTransport();
    const file = new File(['a'], 'a');
    await expect(
      client.beta.agents.environments.files.prepare(Object.fromEntries(paths.map((path) => [path, file]))),
    ).rejects.toThrow('conflict');
    expect(requests).toHaveLength(0);
  });
  test('keeps caller upload order for nonconflicting destinations with shared prefixes', async () => {
    const { client, uploaded } = fileTransport();
    const paths = ['/workspace/z', '/workspace/a-b', '/workspace/a/b', '/workspace/a/bc'];
    const prepared = await client.beta.agents.environments.files.prepare(
      Object.fromEntries(paths.map((path) => [path, new File([path], 'input.txt')])),
    );
    expect(uploaded).toEqual(paths);
    expect(prepared.files).toEqual(
      paths.map((path, i) => ({ type: 'file_id', file_id: `file_${i + 1}`, path })),
    );
  });
  test.each([() => 1, 51 * 1024 * 1024])(
    'accepts upload streams with unrelated size members: %s',
    async (size) => {
      const { client, uploaded } = fileTransport();
      const stream = {
        size,
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('streamed contents');
        },
      };
      const prepared = await client.beta.agents.environments.files.prepare({ '/workspace/a': stream });
      expect(prepared.files).toEqual([{ type: 'file_id', file_id: 'file_1', path: '/workspace/a' }]);
      expect(uploaded).toEqual(['streamed contents']);
    },
  );
  test('leaves file-count and aggregate-size policy to the API', async () => {
    const { client, requests } = fileTransport({
      uploadedSizes: Array.from({ length: 51 }, () => 30 * 1024 * 1024),
    });
    const files = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`/workspace/${i}`, new File(['a'], 'a')]),
    );
    const prepared = await client.beta.agents.environments.files.prepare(files);
    expect(prepared.files).toHaveLength(51);
    expect(prepared.uploadedFiles).toHaveLength(51);
    expect(requests).toHaveLength(51);
  });
  test('submits long destinations and retains the API rejection with uploaded file ownership', async () => {
    const { client, requests, staged } = fileTransport({
      uploadedSizes: [51 * 1024 * 1024],
      failStage: true,
    });
    const path = `/workspace/${'a'.repeat(4096)}`;
    const failure = await client.beta.agents.environments.files
      .upload('env_test', { file: new Response('streamed contents'), path })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentFileUploadError);
    if (!(failure instanceof AgentFileUploadError)) {
      throw new Error('Expected upload error');
    }
    expect(failure.cause).toBeInstanceOf(APIError);
    expect(failure.cause).toEqual(expect.objectContaining({ status: 400 }));
    expect(failure.uploadedFiles.map((file) => file.id)).toEqual(['file_1']);
    expect(requests).toHaveLength(2);
    expect(staged).toEqual([{ type: 'file_id', file_id: 'file_1', path }]);
  });
  test('prepares directory selections without a local file-count limit', async () => {
    const root = await directory();
    const include = Array.from({ length: 51 }, (_, i) => `${i}.txt`);
    await Promise.all(include.map((name) => writeFile(nodePath.join(root, name), 'a')));
    const { client, uploaded } = fileTransport();
    const prepared = await prepareAgentDirectory(client.beta.agents.environments.files, root, { include });
    expect(prepared.files).toHaveLength(51);
    expect(uploaded).toHaveLength(51);
  });
  test('rejects inherited batch keys but honors an explicit request omission', async () => {
    const { client, requests } = fileTransport({ defaultKey: 'default-key' });
    const files = { '/workspace/a': new File(['a'], 'a'), '/workspace/b': new File(['b'], 'b') };
    await expect(client.beta.agents.environments.files.prepare(files)).rejects.toThrow('Idempotency-Key');
    expect(requests).toHaveLength(0);
    await client.beta.agents.environments.files.prepare(files, { headers: { 'Idempotency-Key': null } });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => !request.headers.has('idempotency-key'))).toBe(true);
  });
  test('uses the validated header snapshot throughout a batch', async () => {
    const { client, requests } = fileTransport();
    const headers = new Headers({ 'X-Trace-Test': 'original' });
    const prepared = client.beta.agents.environments.files.prepare(
      { '/workspace/a': new File(['a'], 'a'), '/workspace/b': new File(['b'], 'b') },
      { headers },
    );
    headers.set('Idempotency-Key', 'later-key');
    headers.set('X-Trace-Test', 'changed');
    await prepared;
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => !request.headers.has('idempotency-key'))).toBe(true);
    expect(requests.every((request) => request.headers.get('x-trace-test') === 'original')).toBe(true);
  });
  test('reads accessor-backed batch headers only once', async () => {
    const { client, requests } = fileTransport();
    const read = vi
      .fn()
      .mockReturnValueOnce({ 'X-Trace-Test': 'original' })
      .mockReturnValue({ 'Idempotency-Key': 'later' });
    await client.beta.agents.environments.files.prepare(
      { '/workspace/a': new File(['a'], 'a'), '/workspace/b': new File(['b'], 'b') },
      {
        get headers() {
          return read();
        },
      },
    );
    expect(read).toHaveBeenCalledOnce();
    expect(requests.every((request) => !request.headers.has('idempotency-key'))).toBe(true);
  });
  test('exposes partial uploads without deleting them on later failure', async () => {
    const { client, requests } = fileTransport({ failUpload: 2 });
    const failure = await client.beta.agents.environments.files
      .prepare({ '/workspace/a': new File(['a'], 'a'), '/workspace/b': new File(['b'], 'b') })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentFileUploadError);
    if (!(failure instanceof AgentFileUploadError)) {
      throw new Error('Expected partial upload error');
    }
    expect(failure.uploadedFiles.map((file) => file.id)).toEqual(['file_1']);
    expect(failure.cause).toBeInstanceOf(APIError);
    if (failure.cause instanceof APIError) {
      expect(failure.cause.status).toBe(400);
    }
    expect(Object.prototype.propertyIsEnumerable.call(failure, 'cause')).toBe(false);
    expect(requests.every((req) => req.method === 'POST')).toBe(true);
  });
  test('uploads then stages on the live environment, preserving options and file ownership', async () => {
    const { client, requests, staged } = fileTransport();
    const result = await client.beta.agents.environments.files.upload(
      'env_test',
      { file: new File(['a'], 'a'), path: '/workspace/a' },
      { headers: { 'X-Trace-Test': 'kept', 'Idempotency-Key': 'single' } },
    );
    expect(result.uploadedFile.id).toBe('file_1');
    expect(staged).toEqual([{ type: 'file_id', file_id: 'file_1', path: '/workspace/a' }]);
    expect(requests.every((req) => req.headers.get('x-trace-test') === 'kept')).toBe(true);
    const failed = fileTransport({ failStage: true });
    await expect(
      failed.client.beta.agents.environments.files.upload('env_test', {
        file: new File(['a'], 'a'),
        path: '/workspace/a',
      }),
    ).rejects.toMatchObject({ uploadedFiles: [{ id: 'file_1' }] });
  });
  test('directory selection uploads only explicit files and rejects links before any upload', async () => {
    const root = await directory();
    await writeFile(nodePath.join(root, 'selected.txt'), 'selected');
    await writeFile(nodePath.join(root, 'private.txt'), 'unselected');
    const good = fileTransport();
    await prepareAgentDirectory(good.client.beta.agents.environments.files, root, {
      include: ['selected.txt'],
      to: '/workspace/docs',
    });
    expect(good.uploaded).toEqual(['selected']);
    await symlink(nodePath.join(root, 'private.txt'), nodePath.join(root, 'linked.txt'));
    const bad = fileTransport();
    await expect(
      prepareAgentDirectory(bad.client.beta.agents.environments.files, root, {
        include: ['selected.txt', 'linked.txt'],
      }),
    ).rejects.toThrow('symbolic');
    expect(bad.requests).toHaveLength(0);
  });
  test('allows normal ancestor aliases but rejects a selected root or nested entry symlink', async () => {
    const root = await directory();
    await mkdir(nodePath.join(root, 'physical', 'documents'), { recursive: true });
    await writeFile(nodePath.join(root, 'physical', 'documents', 'source.txt'), 'source');
    await symlink(nodePath.join(root, 'physical'), nodePath.join(root, 'alias'), 'dir');
    const good = fileTransport();
    await prepareAgentDirectory(
      good.client.beta.agents.environments.files,
      nodePath.join(root, 'alias', 'documents'),
      { include: ['source.txt'] },
    );
    expect(good.uploaded).toEqual(['source']);
    const bad = fileTransport();
    await expect(
      prepareAgentDirectory(bad.client.beta.agents.environments.files, nodePath.join(root, 'alias'), {
        include: ['documents/source.txt'],
      }),
    ).rejects.toThrow('symbolic');
    await expect(
      prepareAgentDirectory(bad.client.beta.agents.environments.files, root, {
        include: ['alias/documents/source.txt'],
      }),
    ).rejects.toThrow('symbolic');
    expect(bad.requests).toHaveLength(0);
  });
  test('rejects a resolved file whose identity differs from the checked selection', async () => {
    const root = await directory();
    const selected = nodePath.join(root, 'selected.txt');
    const other = nodePath.join(root, 'other.txt');
    await writeFile(selected, 'selected');
    await writeFile(other, 'other');
    const resolution = vi.spyOn(fsPromises, 'realpath').mockResolvedValueOnce(other);
    try {
      await expect(agentFile(selected)).rejects.toThrow('changed while resolving');
    } finally {
      resolution.mockRestore();
    }
  });
  test.each(['append', 'truncate'] as const)(
    'fails if a selected file changes size during upload: %s',
    async (change) => {
      const root = await directory();
      const path = nodePath.join(root, 'source.txt');
      await writeFile(path, new Uint8Array(256 * 1024));
      const source = await agentFile(path);
      const { data } = source;
      if (!(Symbol.asyncIterator in data)) {
        throw new Error('Expected an iterable source');
      }
      let received = 0;
      const consume = async () => {
        for await (const chunk of data) {
          if (!(chunk instanceof Uint8Array)) {
            throw new Error('Expected file bytes');
          }
          if (received === 0) {
            // oxlint-disable-next-line no-await-in-loop -- Mutate after the source opens and yields its first chunk.
            await (change === 'append' ? appendFile(path, new Uint8Array(128 * 1024)) : truncate(path, 0));
          }
          received += chunk.byteLength;
        }
      };
      await expect(consume()).rejects.toThrow('changed while uploading');
      expect(received).toBeLessThanOrEqual(source.size);
    },
  );
  test('a selected local file that changes identity before upload is not read', async () => {
    const root = await directory();
    const path = nodePath.join(root, 'source.txt');
    await writeFile(path, 'original');
    const source = await agentFile(path);
    await writeFile(path, 'changed-size');
    const { client } = fileTransport();
    await expect(
      client.beta.agents.environments.files.prepare({ '/workspace/source.txt': source }),
    ).rejects.toBeInstanceOf(AgentFileUploadError);
  });
});

describe('beta result artifacts', () => {
  test('returns an unconsumed native response for an exact result artifact, preserving options', async () => {
    const { client, requests } = artifactTransport();
    const response = await client.beta.agents.sessions.artifacts
      .forResult(new AgentTurnResult(turn, []))
      .content(artifact.path, { headers: { 'X-Trace-Test': 'memory' } });
    expect(response).toBeInstanceOf(Response);
    expect(response.bodyUsed).toBe(false);
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('onetwo');
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.headers.get('x-trace-test') === 'memory')).toBe(true);
  });
  test('preserves cancellation before an in-memory content lookup begins', async () => {
    const { client, requests } = artifactTransport();
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.beta.agents.sessions.artifacts
        .forResult(new AgentTurnResult(turn, []))
        .content(artifact.path, { signal: abort.signal }),
    ).rejects.toThrow(/abort/iu);
    expect(requests).toHaveLength(0);
  });
  test('binds identity once, paginates, and streams the exact artifact to the chosen destination', async () => {
    const { client, requests } = artifactTransport();
    const result = new AgentTurnResult({ ...turn }, []);
    const scoped = client.beta.agents.sessions.artifacts.forResult(result);
    expect(requests).toHaveLength(0);
    result.turn.id = 'mutated';
    const chunks: string[] = [];
    const downloaded = await scoped.download(
      {
        path: artifact.path,
        to: new WritableStream({
          write(chunk) {
            chunks.push(new TextDecoder().decode(chunk));
          },
        }),
      },
      { headers: { 'X-Trace-Test': 'kept' } },
    );
    expect(downloaded.id).toBe(artifact.id);
    expect(chunks).toEqual(['one', 'two']);
    expect(requests).toHaveLength(3);
    expect(requests.every((req) => req.headers.get('x-trace-test') === 'kept')).toBe(true);
  });
  test.each(['missing', 'ambiguous'] as const)(
    'fails %s selection before downloading or opening a local destination',
    async (mode) => {
      const { client, requests } = artifactTransport(mode);
      const root = await directory();
      const destination = nodePath.join(root, 'report.md');
      await writeFile(destination, 'keep');
      await expect(
        client.beta.agents.sessions.artifacts
          .forResult(new AgentTurnResult(turn, []))
          .download({ path: artifact.path, to: agentFileDestination(destination) }),
      ).rejects.toThrow(/artifact/u);
      expect(await readFile(destination, 'utf-8')).toBe('keep');
      expect(requests.some((req) => req.url.endsWith('/content'))).toBe(false);
    },
  );
  test('writes to the caller local path without deriving any destination from hosted paths', async () => {
    const { client } = artifactTransport();
    const root = await directory();
    const destination = nodePath.join(root, 'chosen.md');
    await client.beta.agents.sessions.artifacts
      .forResult(new AgentTurnResult(turn, []))
      .download({ path: artifact.path, to: agentFileDestination(destination) });
    expect(await readFile(destination, 'utf-8')).toBe('onetwo');
  });
  test.each(['existing', 'dangling'] as const)(
    'rejects a %s destination symlink without changing its target',
    async (kind) => {
      const { client } = artifactTransport();
      const root = await directory();
      const target = nodePath.join(root, 'target.txt');
      if (kind === 'existing') {
        await writeFile(target, 'unchanged');
      }
      const destination = nodePath.join(root, 'report.md');
      await symlink(target, destination);
      await expect(
        client.beta.agents.sessions.artifacts.forResult(new AgentTurnResult(turn, [])).download({
          path: artifact.path,
          to: agentFileDestination(destination),
        }),
      ).rejects.toThrow('regular files');
      if (kind === 'existing') {
        expect(await readFile(target, 'utf-8')).toBe('unchanged');
      } else {
        await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    },
  );
  test('validates the opened identity before truncating an existing destination', async () => {
    const { client } = artifactTransport();
    const root = await directory();
    const previous = nodePath.join(root, 'previous.txt');
    const destination = nodePath.join(root, 'report.md');
    await writeFile(previous, 'previous');
    await writeFile(destination, 'unchanged');
    const expected = await fsPromises.lstat(previous);
    const metadata = vi.spyOn(fsPromises, 'lstat').mockResolvedValueOnce(expected);
    try {
      await expect(
        client.beta.agents.sessions.artifacts.forResult(new AgentTurnResult(turn, [])).download({
          path: artifact.path,
          to: agentFileDestination(destination),
        }),
      ).rejects.toThrow('changed before opening');
      expect(await readFile(destination, 'utf-8')).toBe('unchanged');
    } finally {
      metadata.mockRestore();
    }
  });
  test('overwrites regular files through ancestor aliases and truncates empty successful downloads', async () => {
    const { client } = artifactTransport();
    const root = await directory();
    const physical = nodePath.join(root, 'physical');
    const alias = nodePath.join(root, 'alias');
    await mkdir(physical);
    await symlink(physical, alias, 'dir');
    const destination = nodePath.join(alias, 'report.md');
    await writeFile(destination, 'previous longer contents');
    await client.beta.agents.sessions.artifacts.forResult(new AgentTurnResult(turn, [])).download({
      path: artifact.path,
      to: agentFileDestination(destination),
    });
    expect(await readFile(nodePath.join(physical, 'report.md'), 'utf-8')).toBe('onetwo');
    await agentFileDestination(destination).getWriter().close();
    expect(await readFile(destination, 'utf-8')).toBe('');
    const empty = nodePath.join(root, 'empty.md');
    await agentFileDestination(empty).getWriter().close();
    expect(await readFile(empty, 'utf-8')).toBe('');
    const aborted = nodePath.join(root, 'aborted.md');
    await agentFileDestination(aborted).abort();
    await expect(readFile(aborted)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('closes a content response when a locked destination cannot accept it', async () => {
    const cancel = vi.fn();
    const client = new OpenAI({
      apiKey: 'synthetic',
      maxRetries: 0,
      fetch: async (url) => {
        if (String(url).endsWith('/content')) {
          return new Response(new ReadableStream({ cancel }));
        }
        return Response.json({ data: [artifact], has_more: false });
      },
    });
    const destination = new WritableStream<Uint8Array>();
    const writer = destination.getWriter();
    try {
      await expect(
        client.beta.agents.sessions.artifacts
          .forResult(new AgentTurnResult(turn, []))
          .download({ path: artifact.path, to: destination }),
      ).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      writer.releaseLock();
    }
  });
  test('a cancelled download aborts its sink and cancels the content stream', async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const sinkAbort = vi.fn();
    const client = new OpenAI({
      apiKey: 'synthetic',
      maxRetries: 0,
      fetch: async (url) => {
        if (String(url).endsWith('/content')) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([1]));
              },
              cancel,
            }),
          );
        }
        return Response.json({ data: [artifact], has_more: false });
      },
    });
    const destination = new WritableStream<Uint8Array>({
      write() {
        abort.abort();
      },
      abort: sinkAbort,
    });
    await expect(
      client.beta.agents.sessions.artifacts
        .forResult(new AgentTurnResult(turn, []))
        .download({ path: artifact.path, to: destination }, { signal: abort.signal }),
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(sinkAbort).toHaveBeenCalledOnce();
  });
});
