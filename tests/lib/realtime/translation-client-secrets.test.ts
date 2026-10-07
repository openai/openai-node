import OpenAI from 'openai';
import type { RealtimeTranslationSession } from 'openai/resources/realtime/realtime';
import { expectTypeOf } from 'vitest';
import { mockFetch } from '../../utils/mock-fetch';

test('translation client secrets route the configured REST request and return a usable translation session', async () => {
  const transport = mockFetch();
  const client = new OpenAI({
    apiKey: 'synthetic-api-key',
    adminAPIKey: 'synthetic-admin-key',
    baseURL: 'https://sdk.example.test/gateway/v1',
    defaultHeaders: { 'x-sdk-request': 'default' },
    fetch: transport.fetch,
  });
  const body = {
    session: { model: 'translation-test', audio: { output: { language: 'fr' } } },
    expires_after: { anchor: 'created_at' as const, seconds: 60 },
  };
  const request = client.realtime.translations.clientSecrets.create(body, {
    headers: { 'x-sdk-request': 'override' },
    query: { trace: 'translation' },
  });
  const received = transport.handleRequest(async (url, init) => {
    const wire = new Request(url, init);
    expect(wire.url).toBe(
      'https://sdk.example.test/gateway/v1/realtime/translations/client_secrets?trace=translation',
    );
    expect(wire.method).toBe('POST');
    expect(wire.headers.get('authorization')).toBe('Bearer synthetic-api-key');
    expect(wire.headers.get('content-type')).toBe('application/json');
    expect(wire.headers.get('x-sdk-request')).toBe('override');
    expect(await wire.json()).toEqual(body);
    return Response.json({
      value: 'ek_synthetic_translation',
      expires_at: 1_800_000_060,
      session: {
        id: 'sess_synthetic',
        type: 'translation',
        model: 'translation-test',
        expires_at: 1_800_001_200,
        audio: { output: { language: 'fr' } },
      },
    });
  });
  const [response] = await Promise.all([request.withResponse(), received]);
  expect(response.response.status).toBe(200);
  expect(response.data.value).toBe('ek_synthetic_translation');
  expect(response.data.expires_at).toBe(1_800_000_060);
  expectTypeOf(response.data.session).toEqualTypeOf<RealtimeTranslationSession>();
  expect(response.data.session).toMatchObject({
    id: 'sess_synthetic',
    type: 'translation',
    model: body.session.model,
    audio: body.session.audio,
  });
});
