import { describe, expect, test, vi } from 'vitest';
import OpenAI, { toStreamingFile } from 'openai';
import { Stream } from 'openai/core/streaming';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import type { TranscriptionCreateParams } from 'openai/resources/audio/transcriptions';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { FileCreateParams } from 'openai/resources/containers/files';
import type { SkillCreateParams } from 'openai/resources/skills';

function clientFor(
  fetch: typeof globalThis.fetch,
  prepare?: (options: FinalRequestOptions) => void,
  apiKey: string | (() => Promise<string>) = 'synthetic-key',
) {
  class PreparedClient extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      prepare?.(options);
    }
  }
  return new PreparedClient({
    apiKey,
    baseURL: 'https://example.invalid',
    maxRetries: 0,
    fetch,
  });
}

function completionResponse(stream: boolean) {
  const common = { id: 'completion_test', created: 0, model: 'test-model' };
  if (stream) {
    const chunk = {
      ...common,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  return Response.json({ ...common, object: 'chat.completion', choices: [] });
}

async function expectCompletion(result: unknown, stream: boolean) {
  if (stream) {
    expect(result).toBeInstanceOf(Stream);
    if (!(result instanceof Stream)) {
      throw new Error('Expected a streaming response');
    }
    const chunks = [];
    for await (const chunk of result) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ choices: [{ delta: { content: 'hello' } }] });
  } else {
    expect(result).toMatchObject({ id: 'completion_test', object: 'chat.completion' });
  }
}

async function* multipartAudioBytes() {
  yield new TextEncoder().encode('audio');
}

describe('request body finalization', () => {
  test('observes immediate image-edit body mutations before normalization', async () => {
    const body = { image: new File(['image'], 'image.png'), prompt: 'old', safety_identifier: null };
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (input === 'data:,') {
          return new Response();
        }
        const form = await new Request(input, init).formData();
        expect(form.get('prompt')).toBe('new');
        expect(form.has('safety_identifier')).toBe(false);
        return Response.json({ created: 0, data: [] });
      }),
    );
    const pending = client.images.edit(body);
    body.prompt = 'new';
    await pending;
  });

  test('sends JSON when an immediate mutation replaces the last upload with an ID', async () => {
    const body: FileCreateParams = { file: new File(['file'], 'file.txt') };
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (input === 'data:,') {
          return new Response();
        }
        const request = new Request(input, init);
        expect(request.headers.get('content-type')).toBe('application/json');
        expect(await request.json()).toEqual({ file_id: 'file_existing' });
        return Response.json({ id: 'file_existing' });
      }),
    );
    const pending = client.containers.files.create('container_test', body);
    delete body.file;
    body.file_id = 'file_existing';
    await pending;
  });

  test('selects the JSON streaming parser without reparsing the complete request', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    let serialized = '';
    try {
      const client = clientFor(
        vi.fn<typeof globalThis.fetch>(async (input, init) => {
          serialized = await new Request(input, init).text();
          expect(serialized).toContain('"stream":true');
          return completionResponse(true);
        }),
      );
      await expectCompletion(
        await client.chat.completions.create({
          model: 'test-model',
          messages: [{ role: 'user', content: 'prompt'.repeat(1000) }],
          stream: true,
        }),
        true,
      );
      expect(parse.mock.calls.filter(([value]) => value === serialized)).toHaveLength(0);
    } finally {
      parse.mockRestore();
    }
  });

  test.each(['retrieve', 'create', 'list', 'multipart'] as const)(
    'rejects %s requests when deferred option capture fails',
    async (kind) => {
      const expected = new Error('option capture failed');
      let captured = false;
      const options = {
        get timeout(): number {
          captured = true;
          throw expected;
        },
      };
      const fetch = vi.fn<typeof globalThis.fetch>();
      const client = clientFor(fetch);
      const invoke = {
        retrieve: () => client.models.retrieve('model_test', options),
        create: () => client.chat.completions.create({ model: 'model_test', messages: [] }, options),
        list: () => client.models.list(options),
        multipart: () =>
          client.files.create({ file: new File(['test'], 'test.txt'), purpose: 'assistants' }, options),
      }[kind];
      const pending = invoke();
      expect(captured).toBe(false);
      await expect(pending).rejects.toBe(expected);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['immediate', 'prepare', 'auth'] as const)(
    'encodes an upload added during %s preparation',
    async (phase) => {
      const body: FileCreateParams = { file_id: 'file_original' };
      const mutate = () => {
        delete body.file_id;
        body.file = new File(['hello'], 'added.txt');
      };
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (input === 'data:,') {
          return new Response();
        }
        const request = new Request(input, init);
        expect(request.headers.get('content-type')).toContain('multipart/form-data');
        const form = await request.formData();
        const file = form.get('file');
        if (file === null || typeof file === 'string') {
          throw new Error('Expected a file part');
        }
        expect(file.name).toBe('added.txt');
        expect(await file.text()).toBe('hello');
        expect(form.has('file_id')).toBe(false);
        return Response.json({ id: 'file_uploaded' });
      });
      const client = clientFor(
        fetch,
        (options) => {
          if (phase !== 'immediate') {
            expect(options.body).toBe(body);
          }
          if (phase === 'prepare') {
            mutate();
          }
        },
        async () => {
          if (phase === 'auth') {
            mutate();
          }
          return 'synthetic-key';
        },
      );
      const pending = client.containers.files.create('container_test', body);
      if (phase === 'immediate') {
        mutate();
      }
      await pending;
      expect(fetch.mock.calls.filter(([input]) => input !== 'data:,')).toHaveLength(1);
    },
  );

  test.each(['skill', 'version'] as const)(
    'preserves directory filenames for a late %s upload',
    async (kind) => {
      const body: SkillCreateParams = {};
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (input === 'data:,') {
          return new Response();
        }
        const request = new Request(input, init);
        expect(request.headers.get('content-type')).toContain('multipart/form-data');
        expect(await request.text()).toContain('filename="nested/SKILL.md"');
        return Response.json({ id: 'skill_test' });
      });
      const client = clientFor(fetch);
      const pending =
        kind === 'skill' ? client.skills.create(body) : client.skills.versions.create('skill_test', body);
      body.files = [new File(['skill contents'], 'nested/SKILL.md')];
      await pending;
      expect(fetch.mock.calls.filter(([input]) => input !== 'data:,')).toHaveLength(1);
    },
  );

  test.each(['skill', 'version'] as const)('preserves immediate %s streaming-file capture', async (kind) => {
    const consume = vi.fn();
    async function* bytes() {
      consume();
      yield new TextEncoder().encode('original');
    }
    const body: SkillCreateParams = { files: [toStreamingFile(bytes(), 'a/SKILL.md')] };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(consume).not.toHaveBeenCalled();
      const form = await new Request(input, init).formData();
      const file = form.get('files[]');
      if (file === null || typeof file === 'string') {
        throw new Error('Expected a file part');
      }
      expect(file.name).toBe('a/SKILL.md');
      expect(await file.text()).toBe('original');
      expect(consume).toHaveBeenCalledOnce();
      return Response.json({ id: 'skill_test' });
    });
    const client = clientFor(fetch);
    const pending =
      kind === 'skill' ? client.skills.create(body) : client.skills.versions.create('skill_test', body);
    body.files = [toStreamingFile(bytes(), 'b/SKILL.md')];
    expect(consume).not.toHaveBeenCalled();
    await pending;
  });

  test('preserves body changes observed while multipart values materialize', async () => {
    const body: FileCreateParams = { file: new File(['original'], 'original.txt') };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (input === 'data:,') {
        return new Response();
      }
      const form = await new Request(input, init).formData();
      const file = form.get('file');
      if (file === null || typeof file === 'string') {
        throw new Error('Expected a file part');
      }
      expect(file.name).toBe('replacement.txt');
      expect(await file.text()).toBe('replacement');
      return Response.json({ id: 'file_uploaded' });
    });
    const pending = clientFor(fetch).containers.files.create('container_test', body);
    body.file = new File(['replacement'], 'replacement.txt');
    await pending;
  });

  test.each([
    [false, 'immediate'],
    [true, 'immediate'],
    [false, 'prepare'],
    [true, 'prepare'],
    [false, 'response'],
    [true, 'response'],
  ] as const)('uses wire stream=%s when the body changes during %s', async (stream, phase) => {
    const body: ChatCompletionCreateParams = {
      model: 'test-model',
      messages: [],
      stream: phase === 'response' ? stream : !stream,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (input === 'data:,') {
        return new Response();
      }
      const sent = await new Request(input, init).json();
      expect(sent).toMatchObject({ stream });
      if (phase === 'response') {
        body.stream = !stream;
      }
      return completionResponse(stream);
    });
    const client = clientFor(fetch, (options) => {
      expect(options.body).toBe(body);
      if (phase === 'prepare') {
        body.stream = stream;
      }
    });
    const pending = client.chat.completions.create(body);
    if (phase === 'immediate') {
      body.stream = stream;
    }
    await expectCompletion(await pending, stream);
    expect(fetch.mock.calls.filter(([input]) => input !== 'data:,')).toHaveLength(1);
  });

  test('uses the overridden body and retains caller metadata', async () => {
    const override = { model: 'test-model', messages: [], stream: true };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (input === 'data:,') {
        return new Response();
      }
      expect(await new Request(input, init).json()).toEqual(override);
      return completionResponse(true);
    });
    const client = clientFor(fetch, (options) => {
      expect(options.body).toBe(override);
      expect(options.__metadata?.['caller']).toBe('retained');
    });
    await expectCompletion(
      await client.chat.completions.create(
        { model: 'test-model', messages: [], stream: false },
        { body: override, __metadata: { caller: 'retained' } },
      ),
      true,
    );
  });

  test.each([false, true])('uses serialized toJSON stream=%s', async (stream) => {
    const body = {
      model: 'test-model',
      messages: [],
      stream: !stream,
      toJSON: () => ({ model: 'test-model', messages: [], stream }),
    };
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        expect(await new Request(input, init).json()).toMatchObject({ stream });
        return completionResponse(stream);
      }),
    );
    await expectCompletion(await client.chat.completions.create(body), stream);
  });

  test.each([false, true])('uses the native JSON value of a boxed stream=%s override', async (stream) => {
    const boxed = new Object(stream);
    Object.defineProperty(boxed, 'valueOf', {
      value: () => {
        throw new Error('must not call custom valueOf');
      },
    });
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        expect(await new Request(input, init).json()).toMatchObject({ stream });
        return completionResponse(stream);
      }),
    );
    await expectCompletion(
      await client.chat.completions.create(
        { model: 'test-model', messages: [], stream: !stream },
        { body: { model: 'test-model', messages: [], stream: boxed } },
      ),
      stream,
    );
  });

  test.each([false, true])(
    'uses native raw JSON stream=%s without materializing the body',
    async (stream) => {
      // SAFETY: Supported Node versions provide native JSON.rawJSON; our TypeScript library predates its declaration.
      const nativeJSON = JSON as typeof JSON & { rawJSON: (text: string) => object };
      const override = { model: 'test-model', messages: [], stream: nativeJSON.rawJSON(String(stream)) };
      const client = clientFor(
        vi.fn<typeof globalThis.fetch>(async (input, init) => {
          expect(await new Request(input, init).json()).toMatchObject({ stream });
          return completionResponse(stream);
        }),
      );
      await expectCompletion(
        await client.chat.completions.create(
          { model: 'test-model', messages: [], stream: !stream },
          { body: override },
        ),
        stream,
      );
    },
  );

  test.each([
    { stream: false, useToJSON: false },
    { stream: true, useToJSON: false },
    { stream: false, useToJSON: true },
    { stream: true, useToJSON: true },
  ])('preserves parser choice for a raw JSON primitive root: %j', async ({ stream, useToJSON }) => {
    // SAFETY: Supported Node versions provide native JSON.rawJSON; our TypeScript library predates its declaration.
    const nativeJSON = JSON as typeof JSON & { rawJSON: (text: string) => object };
    const body = useToJSON ? { toJSON: () => nativeJSON.rawJSON('true') } : nativeJSON.rawJSON('true');
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        expect(await new Request(input, init).text()).toBe('true');
        return completionResponse(stream);
      }),
    );
    await expectCompletion(
      await client.chat.completions.create({ model: 'test-model', messages: [], stream }, { body }),
      stream,
    );
  });

  test('preserves streaming for raw JSON overrides', async () => {
    const body = { model: 'test-model', messages: [], stream: true as const };
    const client = clientFor(vi.fn<typeof globalThis.fetch>(async () => completionResponse(true)));
    await expectCompletion(
      await client.chat.completions.create(body, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      true,
    );
  });

  test.each([false, true])(
    'preserves parser choice without reparsing a large raw body, stream=%s',
    async (stream) => {
      const body = { model: 'test-model', messages: [], stream };
      const rawBody = JSON.stringify({ ...body, stream: !stream, data: 'x'.repeat(1_300_000) });
      const client = clientFor(
        vi.fn<typeof globalThis.fetch>(async (input, init) => {
          expect(await new Request(input, init).text()).toBe(rawBody);
          return completionResponse(stream);
        }),
      );
      const parse = vi.spyOn(JSON, 'parse');
      try {
        await expectCompletion(
          await client.chat.completions.create(body, {
            body: rawBody,
            headers: { 'content-type': 'application/json' },
          }),
          stream,
        );
        expect(parse.mock.calls.some(([value]) => value === rawBody)).toBe(false);
      } finally {
        parse.mockRestore();
      }
    },
  );

  test.each([false, true])('uses the encoded multipart stream=%s', async (stream) => {
    const body: TranscriptionCreateParams = {
      model: 'gpt-4o-transcribe',
      file: new File(['test'], 'audio.wav'),
      stream: !stream,
    };
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (input === 'data:,') {
          return new Response();
        }
        const form = await new Request(input, init).formData();
        expect(form.get('stream')).toBe(String(stream));
        return completionResponse(stream);
      }),
    );
    const pending = body.stream
      ? client.audio.transcriptions.create(body)
      : client.audio.transcriptions.create(body);
    body.stream = stream;
    await expectCompletion(await pending, stream);
  });

  test.each([
    { label: 'boxed true', stream: new Object(true), encoded: null, streaming: false },
    { label: 'boxed false', stream: new Object(false), encoded: null, streaming: false },
    { label: 'string true', stream: 'true', encoded: 'true', streaming: true },
  ])('selects the parser from the emitted multipart $label field', async ({ stream, encoded, streaming }) => {
    const file = toStreamingFile(multipartAudioBytes(), 'audio.wav');
    const client = clientFor(
      vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const form = await new Request(input, init).formData();
        expect(form.get('stream')).toBe(encoded);
        return completionResponse(streaming);
      }),
    );
    await expectCompletion(
      await client.audio.transcriptions.create(
        { model: 'gpt-4o-transcribe', file, stream: false },
        { body: { model: 'gpt-4o-transcribe', file, stream } },
      ),
      streaming,
    );
  });

  test.each([false, true])(
    'retains asynchronous streaming-upload capture from initial stream=%s',
    async (stream) => {
      const consume = vi.fn();
      async function* fileBytes() {
        consume();
        yield new TextEncoder().encode('audio');
      }
      const body: TranscriptionCreateParams = {
        model: 'gpt-4o-transcribe',
        file: toStreamingFile(fileBytes(), 'audio.wav'),
        stream,
      };
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        expect(consume).not.toHaveBeenCalled();
        const form = await new Request(input, init).formData();
        expect(form.get('stream')).toBe(String(!stream));
        expect(consume).toHaveBeenCalledOnce();
        return completionResponse(!stream);
      });
      const client = clientFor(fetch);
      const pending = body.stream
        ? client.audio.transcriptions.create(body)
        : client.audio.transcriptions.create(body);
      expect(consume).not.toHaveBeenCalled();
      body.stream = !stream;
      await expectCompletion(await pending, !stream);
    },
  );

  test.each([false, true])(
    'captures streaming multipart fields after preparation, stream=%s',
    async (stream) => {
      const consume = vi.fn();
      async function* fileBytes() {
        consume();
        yield new TextEncoder().encode('audio');
      }
      const body: TranscriptionCreateParams = {
        model: 'gpt-4o-transcribe',
        file: toStreamingFile(fileBytes(), 'audio.wav'),
        language: 'en',
        stream: !stream,
      };
      const client = clientFor(
        vi.fn<typeof globalThis.fetch>(async (input, init) => {
          expect(consume).not.toHaveBeenCalled();
          const form = await new Request(input, init).formData();
          expect(form.get('language')).toBe('fr');
          expect(form.get('stream')).toBe(String(stream));
          expect(consume).toHaveBeenCalledOnce();
          return completionResponse(stream);
        }),
        (options) => {
          expect(options.body).toBeInstanceOf(ReadableStream);
          body.language = 'fr';
          body.stream = stream;
        },
      );
      const pending = body.stream
        ? client.audio.transcriptions.create(body)
        : client.audio.transcriptions.create(body);
      await expectCompletion(await pending, stream);
    },
  );

  test('keeps explicit parser options on raw client requests', async () => {
    const client = clientFor(vi.fn<typeof globalThis.fetch>(async () => completionResponse(true)));
    await expectCompletion(await client.post('/synthetic', { body: { stream: false }, stream: true }), true);
  });
});
