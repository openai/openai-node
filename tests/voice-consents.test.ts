import { expect, test } from 'vitest';
import OpenAI, { NotFoundError, toFile } from 'openai';
import type { VoiceConsent, VoiceConsentDeleted } from 'openai/resources/audio/voice-consents';

const consent = (id = 'cons_1', name = 'Owned'): VoiceConsent => ({
  id,
  name,
  language: 'en-US',
  created_at: 1_734_220_800,
  object: 'audio.voice_consent',
});

test('consent lifecycle sends multipart bytes, decodes typed responses, and traverses IDs', async () => {
  let capturedRequest: Request | undefined;
  const client = new OpenAI({
    apiKey: 'sk-synthetic',
    baseURL: 'https://unit.invalid/v1',
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      capturedRequest = request.clone();
      const url = new URL(request.url);

      if (url.pathname.endsWith('/missing')) {
        return Response.json(
          { error: { message: 'Missing consent', type: 'invalid_request_error' } },
          { status: 404 },
        );
      }
      if (request.method === 'DELETE') {
        return Response.json({ id: 'cons_1', object: 'audio.voice_consent', deleted: true });
      }
      if (request.method === 'POST' && url.pathname.endsWith('/cons_1')) {
        return Response.json(consent('cons_1', 'Renamed'));
      }
      if (request.method === 'GET' && url.pathname.endsWith('/voice_consents')) {
        const after = url.searchParams.get('after');
        return Response.json({
          object: 'list',
          data: [consent(after ? 'cons_2' : 'cons_1')],
          has_more: !after,
        });
      }
      if (url.pathname.endsWith('/voices')) {
        return Response.json({
          id: 'voice_1',
          object: 'audio.voice',
          name: 'Voice',
          created_at: 1_734_220_800,
        });
      }
      return Response.json(consent());
    },
  });
  const bytes = new Uint8Array([82, 73, 70, 70, 0, 255]);
  const created: VoiceConsent = await client.audio.voiceConsents.create({
    name: 'Owned',
    language: 'en-US',
    recording: await toFile(bytes, 'consent.wav', { type: 'audio/wav' }),
  });
  expect(created).toEqual(consent());
  const lastRequest = () => {
    if (!capturedRequest) {
      throw new Error('Expected a captured request');
    }
    return capturedRequest;
  };
  const upload = lastRequest();
  expect(new URL(upload.url).pathname).toBe('/v1/audio/voice_consents');
  expect(upload.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/u);
  const form = await upload.formData();
  const recording = form.get('recording');
  if (recording === null || typeof recording === 'string') {
    throw new Error('Expected recording file');
  }
  expect(recording.name).toBe('consent.wav');
  expect(recording.type).toBe('audio/wav');
  expect(new Uint8Array(await recording.arrayBuffer())).toEqual(bytes);
  expect(form.get('name')).toBe('Owned');
  expect(form.get('language')).toBe('en-US');
  expect(await client.audio.voiceConsents.retrieve('cons_1')).toEqual(consent());
  const updated = await client.audio.voiceConsents.update('cons_1', { name: 'Renamed' });
  expect(updated.name).toBe('Renamed');
  expect(await lastRequest().json()).toEqual({ name: 'Renamed' });
  const deleted: VoiceConsentDeleted = await client.audio.voiceConsents.delete('cons_1');
  expect(deleted.deleted).toBe(true);
  const values: VoiceConsent[] = [];
  for await (const item of client.audio.voiceConsents.list({ limit: 1 })) {
    values.push(item);
  }
  expect(values.map((v) => v.id)).toEqual(['cons_1', 'cons_2']);
  expect(Object.fromEntries(new URL(lastRequest().url).searchParams)).toEqual({
    limit: '1',
    after: 'cons_1',
  });
  await expect(client.audio.voiceConsents.retrieve('missing')).rejects.toBeInstanceOf(NotFoundError);
  const voice = await client.audio.voices.create({
    name: 'Voice',
    consent: 'cons_1',
    audio_sample: await toFile(bytes, 'voice.wav'),
  });
  expect(voice.id).toBe('voice_1');
  const voiceForm = await lastRequest().formData();
  expect(voiceForm.get('consent')).toBe('cons_1');
});
