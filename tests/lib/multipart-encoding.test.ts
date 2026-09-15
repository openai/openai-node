// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import { toStreamingFile } from '../../src/internal/uploads';
import { encodedMultipartFormRequestOptions } from '../../src/internal/multipart-encoding';

const encodings = {
  offer: { content_type: 'application/sdp', json: false },
  settings: { content_type: 'application/json', json: true },
};
const offer = 'v=0\r\ns=Unicode π\r\n';

test.each([null, { future: { flags: [false, null, 'π'] } }])(
  'typed multipart parts: %p',
  async (settings) => {
    const options = await encodedMultipartFormRequestOptions(
      { body: { offer, settings, ordinary: 'value' }, headers: { 'Content-Type': 'application/json' } },
      fetch,
      encodings,
      'offer',
    );
    expect(options.body).toBeInstanceOf(FormData);
    const request = new Request('https://example.test', { method: 'POST', body: options.body as FormData });
    const wire = await request.clone().text();
    expect(wire).not.toMatch(/filename="[^"]+"/);
    expect(wire).toContain('Content-Type: application/sdp');
    expect(wire).toContain('Content-Type: application/json');
    const form = await request.formData();
    const offerPart = form.get('offer');
    const settingsPart = form.get('settings');
    expect(typeof offerPart === 'string' ? offerPart : await offerPart!.text()).toBe(offer);
    expect(JSON.parse(typeof settingsPart === 'string' ? settingsPart : await settingsPart!.text())).toEqual(
      settings,
    );
    expect(form.get('ordinary')).toBe('value');
  },
);

test('only omission selects the raw alternative', async () => {
  const options = await encodedMultipartFormRequestOptions(
    { body: { offer, settings: undefined } },
    fetch,
    encodings,
    'offer',
  );
  expect(options.body).toBe(offer);
});

// These undeclared extras bypass generated params; mixed upload schemas cannot generate an SDK.
test.each(['streaming-file', 'readable-stream', 'async-iterable'])(
  'rejects undeclared %s overrides without consuming file bytes',
  async (kind) => {
    let consumed = false;
    async function* bytes() {
      consumed = true;
      yield new Uint8Array([1, 2, 3]);
    }
    const upload =
      kind === 'streaming-file'
        ? toStreamingFile(bytes(), 'data.bin')
        : kind === 'readable-stream'
          ? new ReadableStream(
              {
                pull(controller) {
                  consumed = true;
                  controller.enqueue(new Uint8Array([1]));
                  controller.close();
                },
              },
              { highWaterMark: 0 },
            )
          : bytes();
    await expect(
      encodedMultipartFormRequestOptions({ body: { offer, settings: {}, upload } }, fetch, encodings),
    ).rejects.toThrow('Unexpected streaming upload in typed multipart request body');
    expect(consumed).toBe(false);
  },
);

test('preserves buffered file uploads alongside typed parts', async () => {
  const options = await encodedMultipartFormRequestOptions(
    { body: { offer, settings: {}, upload: new File(['bytes'], 'data.bin') } },
    fetch,
    encodings,
  );
  const form = options.body as FormData;
  const upload = form.get('upload') as File;
  expect(upload.name).toBe('data.bin');
  expect(await upload.text()).toBe('bytes');
});
