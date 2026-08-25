import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import OpenAI, { InvalidWebhookSignatureError } from 'openai';

const now = 1_700_000_000;
const secret = 'synthetic-webhook-secret';
const webhookID = 'wh_amplification';
const event = { id: 'evt_amplification', type: 'response.completed', data: { id: 'resp_test' } };
const payload = JSON.stringify(event);
const mismatch = 'The given webhook signature does not match the expected signature';

type Surface = 'verifySignature' | 'unwrap';

function validSignature(timestamp = String(now)): string {
  return createHmac('sha256', secret).update([webhookID, timestamp, payload].join('.')).digest('base64');
}

function makeHeaders(signatures: string[], timestamp = String(now)): Headers {
  return new Headers({
    'webhook-id': webhookID,
    'webhook-signature': signatures.join(' '),
    'webhook-timestamp': timestamp,
  });
}

function runPublicSurface(surface: Surface, headers: Headers): Promise<unknown> {
  const client = new OpenAI({ apiKey: 'test-key', webhookSecret: secret });
  return surface === 'verifySignature'
    ? client.webhooks.verifySignature(payload, headers)
    : client.webhooks.unwrap(payload, headers);
}

async function expectMismatch(surface: Surface, headers: Headers): Promise<void> {
  const operation = runPublicSurface(surface, headers);
  await expect(operation).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  await expect(operation).rejects.toThrow(mismatch);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('public webhook signature verification work', () => {
  test.each(['verifySignature', 'unwrap'] as const)(
    '%s rejects an unsigned, ordinary-sized amplification header before cryptography',
    async (surface) => {
      const candidates = Array.from({ length: 1600 }, () => 'AAAA');
      const headers = makeHeaders(candidates);
      expect(headers.get('webhook-signature')).toHaveLength(7999);

      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      await expectMismatch(surface, headers);
      expect(importKey).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s rejects an over-limit header even when its first signature is valid',
    async (surface) => {
      const headers = makeHeaders([`v1,${validSignature()}`, ...Array.from({ length: 32 }, () => 'AAAA')]);
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      await expectMismatch(surface, headers);
      expect(importKey).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    },
  );

  test.each([
    { surface: 'verifySignature', prefix: 'v1,' },
    { surface: 'verifySignature', prefix: '' },
    { surface: 'unwrap', prefix: 'v1,' },
    { surface: 'unwrap', prefix: '' },
  ] as const)(
    '$surface accepts a real $prefix signature in the final supported rotation slot',
    async ({ surface, prefix }) => {
      const candidates = [...Array.from({ length: 31 }, () => 'AAAA'), prefix + validSignature()];
      const verify = vi.spyOn(crypto.subtle, 'verify');

      const result = await runPublicSurface(surface, makeHeaders(candidates));

      expect(verify).toHaveBeenCalledTimes(32);
      if (surface === 'unwrap') {
        expect(result).toEqual(event);
      } else {
        expect(result).toBeUndefined();
      }
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s continues through malformed signatures to a real rotated signature',
    async (surface) => {
      const result = await runPublicSurface(
        surface,
        makeHeaders(['v1,not-valid-$$$', `v1,${validSignature()}`]),
      );

      if (surface === 'unwrap') {
        expect(result).toEqual(event);
      } else {
        expect(result).toBeUndefined();
      }
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s preserves short mocked signature compatibility',
    async (surface) => {
      const verify = vi.spyOn(crypto.subtle, 'verify').mockResolvedValueOnce(true);
      const result = await runPublicSurface(surface, makeHeaders(['v1,AA==']));

      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[2]).toEqual(Uint8Array.of(0));
      if (surface === 'unwrap') {
        expect(result).toEqual(event);
      } else {
        expect(result).toBeUndefined();
      }
    },
  );

  test.each([
    { timestamp: 'invalid', message: 'Invalid webhook timestamp format' },
    { timestamp: String(now - 301), message: 'Webhook timestamp is too old' },
    { timestamp: String(now + 301), message: 'Webhook timestamp is too new' },
  ])('preserves timestamp validation before rejecting $timestamp', async ({ timestamp, message }) => {
    const headers = makeHeaders(
      Array.from({ length: 33 }, () => 'AAAA'),
      timestamp,
    );
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    const verify = vi.spyOn(crypto.subtle, 'verify');

    await expect(runPublicSurface('verifySignature', headers)).rejects.toThrow(message);
    expect(importKey).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});
