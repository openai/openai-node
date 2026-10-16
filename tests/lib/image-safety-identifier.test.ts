import { expect, test, vi } from 'vitest';
import OpenAI, { toFile, toStreamingFile } from 'openai';

const safetyIdentifier = 'synthetic-image-safety-user';

for (const streaming of [false, true]) {
  for (const lazyUpload of [false, true]) {
    test(`edit normalizes a null body override (stream=${streaming}, lazyUpload=${lazyUpload})`, async () => {
      let requests = 0;
      const client = new OpenAI({
        apiKey: 'synthetic-key',
        baseURL: 'https://example.com/v1',
        maxRetries: 0,
        fetch: async (input, init) => {
          if (input === 'data:,') {
            return new Response();
          }
          requests += 1;
          const request = new Request(input, init);
          expect(request.url).toBe('https://example.com/v1/images/edits');
          const form = await request.formData();
          expect(form.has('safety_identifier')).toBe(false);
          expect(form.get('user')).toBe('override-user');
          expect(form.get('prompt')).toBe('Override prompt');
          expect(form.get('stream')).toBe(streaming ? 'true' : null);
          return streaming
            ? new Response('data: {"type":"image_edit.completed"}\n\n', {
                headers: { 'Content-Type': 'text/event-stream' },
              })
            : Response.json({ created: 1_620_000_000, data: [] });
        },
      });
      const image = lazyUpload
        ? toStreamingFile(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1]));
                controller.close();
              },
            }),
            'test.png',
          )
        : await toFile(new Uint8Array([1]), 'test.png');
      const params = Object.freeze({
        image,
        prompt: 'Primary prompt',
        user: 'primary-user',
        safety_identifier: safetyIdentifier,
      });
      const options = Object.freeze({
        body: Object.freeze({
          image,
          prompt: 'Override prompt',
          user: 'override-user',
          safety_identifier: null,
          ...(streaming ? { stream: true } : {}),
        }),
      });
      if (streaming) {
        const stream = await client.images.edit({ ...params, stream: true }, options);
        let count = 0;
        for await (const event of stream) {
          expect(event.type).toBe('image_edit.completed');
          count += 1;
        }
        expect(count).toBe(1);
      } else {
        await client.images.edit(params, options);
      }
      expect(requests).toBe(1);
      expect(params.safety_identifier).toBe(safetyIdentifier);
      expect(options.body.safety_identifier).toBeNull();
    });
  }
}

test('edit reads the effective body once without inspecting the superseded identifier', async () => {
  const image = await toFile(new Uint8Array([1]), 'test.png');
  let bodyReads = 0;
  let identifierReads = 0;
  let requests = 0;
  const effectiveBody = Object.freeze({
    image,
    prompt: 'Override prompt',
    user: 'override-user',
    get safety_identifier() {
      identifierReads += 1;
      return null;
    },
  });
  const options = Object.freeze({
    get body() {
      bodyReads += 1;
      return effectiveBody;
    },
  });
  const params = Object.freeze({
    image,
    prompt: 'Primary prompt',
    get safety_identifier(): string {
      throw new Error('Superseded identifier must not be read');
    },
  });
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    baseURL: 'https://example.com/v1',
    maxRetries: 0,
    fetch: async (input, init) => {
      if (input === 'data:,') {
        return new Response();
      }
      requests += 1;
      const form = await new Request(input, init).formData();
      expect(form.has('safety_identifier')).toBe(false);
      expect(form.get('prompt')).toBe('Override prompt');
      expect(form.get('user')).toBe('override-user');
      return Response.json({ created: 1_620_000_000, data: [] });
    },
  });
  await client.images.edit(params, options);
  expect(requests).toBe(1);
  expect(bodyReads).toBe(1);
  expect(identifierReads).toBe(1);
});

for (const property of ['inherited', 'non-enumerable', 'getter']) {
  test(`edit preserves own enumerable field semantics for a ${property} identifier`, async () => {
    let requests = 0;
    let reads = 0;
    const client = new OpenAI({
      apiKey: 'synthetic-key',
      baseURL: 'https://example.com/v1',
      maxRetries: 0,
      fetch: async (input, init) => {
        if (input === 'data:,') {
          return new Response();
        }
        requests += 1;
        const form = await new Request(input, init).formData();
        expect(form.has('safety_identifier')).toBe(false);
        expect(form.get('user')).toBe('legacy-user');
        return Response.json({ created: 1_620_000_000, data: [] });
      },
    });
    const params = {
      image: await toFile(new Uint8Array([1]), 'test.png'),
      prompt: 'A synthetic image',
      user: 'legacy-user',
    };
    if (property === 'inherited') {
      Object.setPrototypeOf(params, { safety_identifier: safetyIdentifier });
    } else if (property === 'non-enumerable') {
      Object.defineProperty(params, 'safety_identifier', { value: safetyIdentifier });
    } else {
      Object.defineProperty(params, 'safety_identifier', {
        enumerable: true,
        get() {
          reads += 1;
          return null;
        },
      });
    }
    await client.images.edit(Object.freeze(params));
    expect(requests).toBe(1);
    expect(reads).toBe(property === 'getter' ? 1 : 0);
  });
}

test('edit preserves request-options body precedence when normalizing a null identifier', async () => {
  const image = await toFile(new Uint8Array([1]), 'test.png');
  let requests = 0;
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    baseURL: 'https://example.com/v1',
    maxRetries: 0,
    fetch: async (input, init) => {
      if (input === 'data:,') {
        return new Response();
      }
      requests += 1;
      const form = await new Request(input, init).formData();
      expect(form.get('safety_identifier')).toBe('override-user');
      expect(form.get('prompt')).toBe('Override prompt');
      return Response.json({ created: 1_620_000_000, data: [] });
    },
  });
  await client.images.edit(
    { image, prompt: 'Original prompt', safety_identifier: null },
    { body: { image, prompt: 'Override prompt', safety_identifier: 'override-user' } },
  );
  expect(requests).toBe(1);
});

for (const value of [safetyIdentifier, null, '', undefined]) {
  for (const streaming of [false, true]) {
    for (const lazyUpload of [false, true]) {
      test(`edit sends safety_identifier=${String(value)} (stream=${streaming}, lazyUpload=${lazyUpload})`, async () => {
        let requests = 0;
        const fetch: typeof globalThis.fetch = async (input, init) => {
          if (input === 'data:,') {
            return new Response();
          }
          requests += 1;
          const request = new Request(input, init);
          expect(request.url).toBe('https://example.com/v1/images/edits');
          const form = await request.formData();
          expect(form.has('safety_identifier')).toBe(value !== null && value !== undefined);
          expect(form.get('safety_identifier')).toBe(value ?? null);
          expect(form.get('user')).toBe('legacy-user');
          expect(form.get('prompt')).toBe('A synthetic image');
          return streaming
            ? new Response('data: {"type":"image_edit.completed"}\n\n', {
                headers: { 'Content-Type': 'text/event-stream' },
              })
            : Response.json({ created: 1_620_000_000, data: [] });
        };
        const client = new OpenAI({
          apiKey: 'synthetic-key',
          baseURL: 'https://example.com/v1',
          fetch,
          maxRetries: 0,
        });
        const image = lazyUpload
          ? toStreamingFile(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array([1]));
                  controller.close();
                },
              }),
              'test.png',
            )
          : await toFile(new Uint8Array([1]), 'test.png');
        const params = Object.freeze({
          image,
          prompt: 'A synthetic image',
          user: 'legacy-user',
          ...(value === undefined ? {} : { safety_identifier: value }),
        });
        if (streaming) {
          const stream = await client.images.edit({ ...params, stream: true });
          let events = 0;
          for await (const event of stream) {
            expect(event.type).toBe('image_edit.completed');
            events += 1;
          }
          expect(events).toBe(1);
        } else {
          await client.images.edit(params);
        }
        expect(requests).toBe(1);
        expect(params.safety_identifier).toBe(value);
      });
    }
  }
}

for (const operation of ['generate', 'edit'] as const) {
  for (const value of [safetyIdentifier, null, undefined]) {
    for (const streaming of [false, true]) {
      test(`${operation} preserves safety_identifier=${String(value)} (stream=${streaming})`, async () => {
        const field = value === undefined ? {} : { safety_identifier: value };
        const payload = streaming
          ? {
              type: operation === 'generate' ? 'image_generation.completed' : 'image_edit.completed',
              b64_json: 'c3ludGhldGlj',
              created_at: 1_620_000_000,
              size: '1024x1024',
              quality: 'high',
              background: 'transparent',
              output_format: 'png',
              usage: {
                total_tokens: 100,
                input_tokens: 50,
                output_tokens: 50,
                input_tokens_details: { text_tokens: 10, image_tokens: 40 },
              },
              ...field,
            }
          : { created: 1_620_000_000, data: [{ b64_json: 'c3ludGhldGlj' }], ...field };
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
          if (input === 'data:,') {
            return new Response();
          }
          return streaming
            ? new Response(`data: ${JSON.stringify(payload)}\n\n`, {
                headers: { 'Content-Type': 'text/event-stream' },
              })
            : Response.json(payload);
        });
        const client = new OpenAI({ apiKey: 'synthetic-key', baseURL: 'https://example.com/v1', fetch });
        const params = {
          prompt: 'A synthetic image',
          safety_identifier: safetyIdentifier,
          user: 'legacy-user',
        };
        if (streaming) {
          const stream =
            operation === 'generate'
              ? await client.images.generate({ ...params, stream: true })
              : await client.images.edit({
                  ...params,
                  image: await toFile(new Uint8Array([1]), 'test.png'),
                  stream: true,
                });
          let count = 0;
          for await (const event of stream) {
            expect(event.type).toBe(
              operation === 'generate' ? 'image_generation.completed' : 'image_edit.completed',
            );
            if (event.type !== 'image_generation.completed' && event.type !== 'image_edit.completed') {
              throw new Error('Expected a completed image event');
            }
            expect(event.safety_identifier).toBe(value);
            count += 1;
          }
          expect(count).toBe(1);
        } else {
          const response =
            operation === 'generate'
              ? await client.images.generate(params)
              : await client.images.edit({ ...params, image: await toFile(new Uint8Array([1]), 'test.png') });
          expect(response.safety_identifier).toBe(value);
        }
        const calls = fetch.mock.calls.filter(([input]) => input !== 'data:,');
        expect(calls).toHaveLength(1);
        const [args] = calls;
        if (!args) {
          throw new Error('Expected a captured request');
        }
        const request = new Request(...args);
        expect(request.url).toBe(
          `https://example.com/v1/images/${operation === 'generate' ? 'generations' : 'edits'}`,
        );
        expect(request.method).toBe('POST');
        if (operation === 'generate') {
          expect(await request.json()).toMatchObject({
            safety_identifier: safetyIdentifier,
            user: 'legacy-user',
          });
        } else {
          const form = await request.formData();
          expect(form.get('safety_identifier')).toBe(safetyIdentifier);
          expect(form.get('user')).toBe('legacy-user');
        }
      });
    }
  }
}
