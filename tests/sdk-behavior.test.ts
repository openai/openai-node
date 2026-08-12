import { vi } from 'vitest';

import OpenAI from 'openai';
import { buildHeaders, isEmptyHeaders } from 'openai/internal/headers';
import { compact, decode, is_regexp, maybe_map } from 'openai/internal/qs/utils';
import { toFloat32Array } from 'openai/internal/utils/base64';

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    headers: { 'content-type': 'application/json' },
  });
}

describe('handwritten SDK behavior', () => {
  test('sends PATCH and DELETE requests through their public helpers', async () => {
    const fetch = vi.fn(async () => jsonResponse({ updated: true }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    await expect(client.patch('/items/123', { body: { enabled: true } })).resolves.toEqual({ updated: true });
    await expect(client.delete('/items/123')).resolves.toEqual({ updated: true });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.openai.com/v1/items/123',
      expect.objectContaining({ method: 'PATCH', body: '{"enabled":true}' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.openai.com/v1/items/123',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('forwards parsed response rejections through APIPromise.catch', async () => {
    const client = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: vi.fn(async () =>
        Response.json(
          { error: { message: 'request failed' } },
          {
            headers: { 'content-type': 'application/json' },
            status: 400,
          },
        ),
      ),
    });

    const result = await client.get('/items/123').catch((error: Error) => error.message);

    expect(result).toBe('400 request failed');
  });

  test('runs APIPromise.finally after parsing a successful response', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 'item_123' }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });
    const cleanup = vi.fn();

    await expect(client.get('/items/123').finally(cleanup)).resolves.toEqual({ id: 'item_123' });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('recognizes empty and populated normalized headers', () => {
    expect(isEmptyHeaders(undefined)).toBe(true);
    expect(isEmptyHeaders(buildHeaders([{ 'X-Test': 'present' }]))).toBe(false);
  });

  test('decodes base64-encoded floating-point arrays', () => {
    const values = new Float32Array([1.25, -2.5, 0]);
    const encoded = Buffer.from(values.buffer).toString('base64');

    expect(toFloat32Array(encoded)).toEqual([1.25, -2.5, 0]);
  });

  test('decodes query values using UTF-8 and ISO-8859-1', () => {
    expect(decode('hello+world%21', undefined, 'utf-8')).toBe('hello world!');
    expect(decode('%E9', undefined, 'iso-8859-1')).toBe('é');
  });

  test('compacts nested sparse query arrays without mutating their entries', () => {
    const nested = { values: ['first', undefined, 'third'] };

    expect(compact(nested)).toEqual({ values: ['first', 'third'] });
  });

  test('recognizes regular expressions and maps query values', () => {
    expect(is_regexp(/sdk/)).toBe(true);
    expect(is_regexp('sdk')).toBe(false);
    expect(maybe_map([1, 2], (value) => value * 2)).toEqual([2, 4]);
  });

  test('requests file content as a binary response', async () => {
    const fetch = vi.fn(async () => new Response('file contents'));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    const response = await client.files.content('file_123');

    await expect(response.text()).resolves.toBe('file contents');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/files/file_123/content',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('returns files immediately when processing has already completed', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 'file_123', status: 'processed' }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    await expect(client.files.waitForProcessing('file_123')).resolves.toMatchObject({
      id: 'file_123',
      status: 'processed',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('creates both realtime and transcription sessions through their factories', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 'session_123' }));
    const client = new OpenAI({ apiKey: 'test-key', fetch });

    await client.beta.realtime.sessions.create({ model: 'gpt-4o-realtime-preview' });
    await client.beta.realtime.transcriptionSessions.create({});

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/realtime/sessions'),
      expect.anything(),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/realtime/transcription_sessions'),
      expect.anything(),
    );
  });
});
