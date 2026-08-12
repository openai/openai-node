import OpenAI, { toFile, toStreamingFile } from 'openai';
import type { Uploadable } from 'openai';

interface RecordedRequest {
  url: string;
  body: unknown;
  authorization: string | null;
}

async function* skillAssetChunks(): AsyncGenerator<string> {
  yield 'streamed asset';
}

function createClient(): { client: OpenAI; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async (url, init) => {
      if (String(url) === 'data:,') {
        return new Response('');
      }

      requests.push({
        url: String(url),
        body: init?.body,
        authorization: new Headers(init?.headers).get('authorization'),
      });

      return Response.json({ id: 'skill_123' });
    },
  });

  return { client, requests };
}

const skillEndpoints = [
  {
    name: 'skill creation',
    path: '/v1/skills',
    create: (client: OpenAI, files: Uploadable[]) => client.skills.create({ files }),
  },
  {
    name: 'skill version creation',
    path: '/v1/skills/skill_123/versions',
    create: (client: OpenAI, files: Uploadable[]) => client.skills.versions.create('skill_123', { files }),
  },
] as const;

describe.each(skillEndpoints)('$name', ({ path, create }) => {
  test('preserves directory names for buffered skill uploads', async () => {
    const { client, requests } = createClient();

    await create(client, [
      new File(['manifest'], 'my-skill/SKILL.md'),
      new File(['asset'], 'my-skill/assets/data.txt'),
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`https://api.openai.com${path}`);
    expect(requests[0]?.authorization).toBe('Bearer test-key');

    const form = requests[0]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll('files[]').map((file) => (file as File).name)).toEqual([
      'my-skill/SKILL.md',
      'my-skill/assets/data.txt',
    ]);
  });

  test('preserves browser directory paths when native files are explicitly renamed', async () => {
    const { client, requests } = createClient();
    const selectedFile: File & { webkitRelativePath?: string } = new File(['manifest'], 'SKILL.md', {
      type: 'text/markdown',
      lastModified: 1234,
    });
    Object.defineProperty(selectedFile, 'webkitRelativePath', { value: 'my-skill/SKILL.md' });

    await create(client, [await toFile(selectedFile, selectedFile.webkitRelativePath)]);

    const form = requests[0]?.body as FormData;
    const uploaded = form.get('files[]') as File;
    expect(uploaded.name).toBe('my-skill/SKILL.md');
    expect(uploaded.type).toBe('text/markdown');
  });

  test('preserves directory names for mixed buffered and streaming uploads', async () => {
    const { client, requests } = createClient();

    await create(client, [
      new File(['manifest'], 'my-skill/SKILL.md'),
      toStreamingFile(skillAssetChunks(), 'my-skill/assets/data.txt'),
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe('Bearer test-key');

    const body = await new Response(requests[0]?.body as ReadableStream).text();
    expect(body).toContain('filename="my-skill/SKILL.md"');
    expect(body).toContain('filename="my-skill/assets/data.txt"');
    expect(body).toContain('streamed asset');
  });
});

test('continues stripping directory names for ordinary file uploads', async () => {
  const { client, requests } = createClient();

  await client.files.create({
    file: new File(['contents'], 'private-directory/input.jsonl'),
    purpose: 'assistants',
  });

  expect(requests).toHaveLength(1);
  const form = requests[0]?.body as FormData;
  expect((form.get('file') as File).name).toBe('input.jsonl');
});
