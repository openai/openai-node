import OpenAI, { toStreamingFile } from 'openai';
import type { Uploadable } from 'openai';
import { multipartFormRequestOptions } from 'openai/internal/uploads';

interface CapturedRequest {
  url: string;
  body: string;
}

function createClient(): { client: OpenAI; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const transport = Object.assign(
    async (url: Request | URL | string, options?: RequestInit): Promise<Response> => {
      if (!options?.body) {
        throw new Error('Expected a multipart upload body');
      }

      requests.push({ url: String(url), body: await new Response(options.body).text() });
      return Response.json({ id: 'file_123', object: 'file', created: 0, data: [], text: 'transcribed' });
    },
    { Response },
  );

  return {
    client: new OpenAI({ apiKey: 'test-api-key', fetch: transport as typeof fetch }),
    requests,
  };
}

async function* fileChunks(contents = 'streamed contents'): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(contents);
}

function uploadedFilenames(body: string): string[] {
  return Array.from(body.matchAll(/filename="(?<name>[^"]+)"/gu), (match) => match.groups?.['name'] ?? '');
}

function capturedRequest(requests: CapturedRequest[], index = 0): CapturedRequest {
  const request = requests[index];
  if (!request) {
    throw new Error(`Expected captured upload request at index ${index}`);
  }

  return request;
}

const ordinaryUploadEndpoints = [
  {
    name: 'file uploads',
    submit: (client: OpenAI, file: Uploadable) => client.files.create({ file, purpose: 'assistants' }),
  },
  {
    name: 'image edits',
    submit: (client: OpenAI, file: Uploadable) =>
      client.images.edit({ image: file, model: 'gpt-image-1', prompt: 'Edit the image' }),
  },
  {
    name: 'audio transcriptions',
    submit: (client: OpenAI, file: Uploadable) =>
      client.audio.transcriptions.create({ file, model: 'whisper-1' }),
  },
] as const;

const skillUploadEndpoints = [
  {
    name: 'skill creation',
    submit: (client: OpenAI, file: Uploadable) => client.skills.create({ files: [file] }),
  },
  {
    name: 'skill version creation',
    submit: (client: OpenAI, file: Uploadable) =>
      client.skills.versions.create('skill_123', { files: [file] }),
  },
] as const;

const unsafeSkillFilenames = [
  { name: 'absolute POSIX', filename: '/private/secret.txt' },
  { name: 'absolute Windows drive', filename: 'C:\\Users\\alice\\secret.txt' },
  { name: 'drive-relative Windows', filename: 'C:private\\secret.txt' },
  { name: 'Windows UNC', filename: '\\\\server\\share\\secret.txt' },
  { name: 'Windows device', filename: '\\\\?\\C:\\private\\secret.txt' },
  { name: 'parent traversal', filename: '../secret.txt' },
  { name: 'nested parent traversal', filename: 'assets/../secret.txt' },
  { name: 'Windows parent traversal', filename: 'assets\\..\\secret.txt' },
] as const;

const skillUploadModes = [
  { name: 'buffered', create: (filename: string) => new File(['skill'], filename) },
  { name: 'streaming', create: (filename: string) => toStreamingFile(fileChunks('skill'), filename) },
] as const;

describe('streaming upload filename privacy', () => {
  test.each([
    ['/home/sdk-user/private-project/traces/input.jsonl', 'input.jsonl'],
    ['C:\\Users\\sdk-user\\private-project\\traces\\input.jsonl', 'input.jsonl'],
    ['private-project/traces/input.jsonl', 'input.jsonl'],
  ] as const)('matches buffered filename stripping for %s', async (filename, basename) => {
    const { client, requests } = createClient();

    await client.files.create({
      file: toStreamingFile(fileChunks(), filename, { type: 'text/plain' }),
      purpose: 'assistants',
    });
    await client.files.create({
      file: new File(['buffered contents'], filename, { type: 'text/plain' }),
      purpose: 'assistants',
    });

    expect(requests).toHaveLength(2);
    const streamed = capturedRequest(requests);
    const buffered = capturedRequest(requests, 1);
    expect(uploadedFilenames(streamed.body)).toEqual([basename]);
    expect(uploadedFilenames(buffered.body)).toEqual([basename]);
    expect(streamed.url).toBe('https://api.openai.com/v1/files');
    expect(streamed.body).toContain('Content-Type: text/plain');
    expect(streamed.body).not.toContain('sdk-user');
    expect(streamed.body).not.toContain('private-project');
    expect(streamed.body).not.toContain('traces');
  });

  test.each([
    ['NUL', '\0', '%00'],
    ['newline', '\n', '%0A'],
    ['carriage return', '\r', '%0D'],
    ['DEL', '\u007F', '%7F'],
  ] as const)(
    'strips Windows parent directories before escaping %s in streaming filenames',
    async (_, control, escaped) => {
      const { client, requests } = createClient();

      await client.files.create({
        file: toStreamingFile(fileChunks(), `C:\\Users\\alice\\private\\${control}recording.wav`),
        purpose: 'assistants',
      });

      const request = capturedRequest(requests);
      expect(uploadedFilenames(request.body)).toEqual([`${escaped}recording.wav`]);
      expect(request.body).not.toContain('alice');
      expect(request.body).not.toContain('private');
      expect(request.body).not.toContain('%5C');
    },
  );

  test.each(ordinaryUploadEndpoints)(
    'never exposes POSIX or Windows parent directories through $name',
    async ({ submit }) => {
      const { client, requests } = createClient();

      await submit(client, toStreamingFile(fileChunks(), '/home/alice/private/recording.wav'));
      await submit(client, toStreamingFile(fileChunks(), 'C:\\Users\\alice\\private\\recording.wav'));

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(uploadedFilenames(request.body)).toEqual(['recording.wav']);
        expect(request.body).not.toContain('alice');
        expect(request.body).not.toContain('private');
        expect(request.body).not.toContain('%5C');
      }
    },
  );

  test.each(
    skillUploadEndpoints.flatMap((endpoint) =>
      unsafeSkillFilenames.flatMap((path) => skillUploadModes.map((mode) => ({ endpoint, path, mode }))),
    ),
  )('$endpoint.name rejects $path.name paths in $mode.name uploads', async ({ endpoint, path, mode }) => {
    const { client, requests } = createClient();

    await expect(endpoint.submit(client, mode.create(path.filename))).rejects.toThrow(/safe relative/iu);
    expect(requests).toHaveLength(0);
  });

  test.each(skillUploadEndpoints)(
    'preserves explicitly opted-in POSIX and Windows directories for $name',
    async ({ submit }) => {
      const { client, requests } = createClient();

      await submit(client, toStreamingFile(fileChunks(), 'my-skill/assets/manifest.txt'));
      await submit(client, toStreamingFile(fileChunks(), 'my-skill\\assets\\manifest.txt'));
      await submit(client, new File(['buffered skill'], 'my-skill/assets/manifest.txt'));
      await submit(client, new File(['buffered skill'], 'my-skill\\assets\\manifest.txt'));

      expect(requests).toHaveLength(4);
      expect(requests.map(({ body }) => uploadedFilenames(body))).toEqual([
        ['my-skill/assets/manifest.txt'],
        ['my-skill/assets/manifest.txt'],
        ['my-skill/assets/manifest.txt'],
        ['my-skill/assets/manifest.txt'],
      ]);
    },
  );

  test('strips explicitly configured filename paths without consuming stream chunks early', async () => {
    let reads = 0;
    async function* lazyChunks(): AsyncGenerator<Uint8Array> {
      reads += 1;
      yield new TextEncoder().encode('lazy contents');
    }

    const request = await multipartFormRequestOptions(
      {
        body: {
          file: toStreamingFile(lazyChunks(), 'private-folder\\nested\\report.txt', {
            type: 'text/markdown',
          }),
        },
      },
      fetch,
      { stripFilenames: true },
    );

    expect(reads).toBe(0);
    const body = await new Response(request.body as ReadableStream).text();
    expect(reads).toBe(1);
    expect(uploadedFilenames(body)).toEqual(['report.txt']);
    expect(body).toContain('Content-Type: text/markdown');
    expect(body).toContain('lazy contents');
    expect(body).not.toContain('private-folder');
  });

  test('preserves sparse mixed upload ordering, metadata, and multipart escaping', async () => {
    const { client, requests } = createClient();
    const images: Uploadable[] = [];
    images[1] = toStreamingFile(fileChunks('base image'), '/private/base"image.png', { type: 'image/png' });
    images[3] = new File(['overlay image'], 'private\\overlay.png', { type: 'image/webp' });
    const mask = new File(['mask'], '/private/mask.png', { type: 'image/png' });

    await client.images.edit({
      image: images,
      mask,
      model: 'gpt-image-1',
      prompt: 'Keep the private image names and ordering safe',
    });

    expect(requests).toHaveLength(1);
    const { body } = capturedRequest(requests);
    expect(uploadedFilenames(body)).toEqual(['base%22image.png', 'overlay.png', 'mask.png']);
    expect(body).toContain('Content-Type: image/png');
    expect(body).toContain('Content-Type: image/webp');
    expect(body).not.toContain('/private/');
    expect(body).not.toContain('private%5C');
    expect(0 in images).toBe(false);
    expect(2 in images).toBe(false);
  });

  test.each(['private-folder/nested/', 'private-folder\\nested\\'] as const)(
    'replaces trailing path separators with a private fallback filename: %s',
    async (filename) => {
      const { client, requests } = createClient();

      await client.files.create({ file: toStreamingFile(fileChunks(), filename), purpose: 'assistants' });

      const { body } = capturedRequest(requests);
      expect(uploadedFilenames(body)).toEqual(['unknown_file']);
      expect(body).not.toContain('private-folder');
      expect(body).not.toContain('nested');
    },
  );

  test('retains empty-name validation for newly created and mutated streaming files', async () => {
    expect(() => toStreamingFile(fileChunks(), '')).toThrow('requires a non-empty file name');

    const upload = toStreamingFile(fileChunks(), 'valid.txt');
    Object.assign(upload, { name: '' });
    const request = await multipartFormRequestOptions({ body: { upload } }, fetch);

    await expect(new Response(request.body as ReadableStream).text()).rejects.toThrow(
      'Streaming upload file name must be a non-empty string',
    );
  });
});
