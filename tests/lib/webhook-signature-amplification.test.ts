import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import OpenAI, { InvalidWebhookSignatureError } from 'openai';

const now = 1_700_000_000;
const secret = 'synthetic-webhook-secret';
const webhookID = 'wh_amplification';
const event = { id: 'evt_amplification', type: 'response.completed', data: { id: 'resp_test' } };
const payload = JSON.stringify(event);
const mismatch = 'The given webhook signature does not match the expected signature';
const unsupportedCrypto =
  'Webhook signature verification is only supported when the `crypto` global is defined';

type Surface = 'verifySignature' | 'unwrap';

function validSignature(timestamp = String(now), signedPayload = payload): string {
  return createHmac('sha256', secret)
    .update([webhookID, timestamp, signedPayload].join('.'))
    .digest('base64');
}

function invalidSignature(index: number): string {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index);
  return bytes.toString('base64');
}

function makeHeaders(signatures: string[], timestamp = String(now)): Headers {
  return new Headers({
    'webhook-id': webhookID,
    'webhook-signature': signatures.join(' '),
    'webhook-timestamp': timestamp,
  });
}

function runPublicSurface(surface: Surface, headers: Headers, signedPayload = payload): Promise<unknown> {
  const client = new OpenAI({ apiKey: 'test-key', webhookSecret: secret });
  return surface === 'verifySignature'
    ? client.webhooks.verifySignature(signedPayload, headers)
    : client.webhooks.unwrap(signedPayload, headers);
}

function expectSuccessfulResult(surface: Surface, result: unknown, expectedEvent: unknown = event): void {
  if (surface === 'unwrap') {
    expect(result).toEqual(expectedEvent);
  } else {
    expect(result).toBeUndefined();
  }
}

async function expectMismatch(surface: Surface, headers: Headers): Promise<void> {
  const operation = runPublicSurface(surface, headers);
  await expect(operation).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  await expect(operation).rejects.toThrow(mismatch);
}

function omitWebCryptoMethod(method: 'importKey' | 'sign' | 'verify'): void {
  const { subtle } = crypto;
  const methods = {
    importKey: subtle.importKey.bind(subtle),
    sign: subtle.sign.bind(subtle),
    verify: subtle.verify.bind(subtle),
  };
  Reflect.deleteProperty(methods, method);
  vi.stubGlobal('crypto', { subtle: methods });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('public webhook signature verification work', () => {
  test.each([
    { surface: 'verifySignature', capability: 'crypto' },
    { surface: 'verifySignature', capability: 'subtle' },
    { surface: 'verifySignature', capability: 'importKey' },
    { surface: 'verifySignature', capability: 'verify' },
    { surface: 'unwrap', capability: 'crypto' },
    { surface: 'unwrap', capability: 'subtle' },
    { surface: 'unwrap', capability: 'importKey' },
    { surface: 'unwrap', capability: 'verify' },
  ] as const)(
    '$surface rejects missing $capability with the existing unsupported-crypto error',
    async ({ surface, capability }) => {
      const headers = makeHeaders([`v1,${validSignature()}`]);

      if (capability === 'crypto') {
        vi.stubGlobal('crypto', crypto);
        Reflect.deleteProperty(globalThis, 'crypto');
      } else if (capability === 'subtle') {
        vi.stubGlobal('crypto', {});
      } else {
        omitWebCryptoMethod(capability);
      }

      const result = runPublicSurface(surface, headers);
      await expect(result).rejects.toThrow(unsupportedCrypto);
      await expect(result).rejects.not.toBeInstanceOf(InvalidWebhookSignatureError);
    },
  );

  test.each([
    { surface: 'verifySignature', candidates: 1 },
    { surface: 'verifySignature', candidates: 32 },
    { surface: 'unwrap', candidates: 1 },
    { surface: 'unwrap', candidates: 32 },
  ] as const)(
    '$surface accepts $candidates candidates without an unnecessary sign capability',
    async ({ surface, candidates }) => {
      const headers = makeHeaders([
        ...Array.from({ length: candidates - 1 }, () => 'AAAA'),
        `v1,${validSignature()}`,
      ]);
      omitWebCryptoMethod('sign');

      expectSuccessfulResult(surface, await runPublicSurface(surface, headers));
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s rejects a large valid rotation header without sign using the unsupported-crypto error',
    async (surface) => {
      const headers = makeHeaders([
        ...Array.from({ length: 32 }, (_, index) => invalidSignature(index)),
        `v1,${validSignature()}`,
      ]);
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const verify = vi.spyOn(crypto.subtle, 'verify');
      omitWebCryptoMethod('sign');

      const result = runPublicSurface(surface, headers);
      await expect(result).rejects.toThrow(unsupportedCrypto);
      await expect(result).rejects.not.toBeInstanceOf(InvalidWebhookSignatureError);
      expect(importKey).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    },
  );

  test.each([
    { surface: 'verifySignature', prefix: 'v1,' },
    { surface: 'verifySignature', prefix: '' },
    { surface: 'unwrap', prefix: 'v1,' },
    { surface: 'unwrap', prefix: '' },
  ] as const)('$surface accepts a $prefix signature in rotation slot 33', async ({ surface, prefix }) => {
    const headers = makeHeaders([...Array.from({ length: 32 }, () => 'AAAA'), prefix + validSignature()]);
    const sign = vi.spyOn(crypto.subtle, 'sign');
    const verify = vi.spyOn(crypto.subtle, 'verify');

    const result = await runPublicSurface(surface, headers);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expectSuccessfulResult(surface, result);
  });

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s rejects an unsigned, ordinary-sized amplification header before cryptography',
    async (surface) => {
      const candidates = Array.from({ length: 1600 }, () => 'AAAA');
      const headers = makeHeaders(candidates);
      expect(headers.get('webhook-signature')).toHaveLength(7999);

      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      await expectMismatch(surface, headers);
      expect(importKey).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s accepts a long rotation header when its first signature is valid',
    async (surface) => {
      const headers = makeHeaders([`v1,${validSignature()}`, ...Array.from({ length: 32 }, () => 'AAAA')]);
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      const result = await runPublicSurface(surface, headers);

      expect(importKey).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expectSuccessfulResult(surface, result);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s accepts a late valid signature after thousands of distinct candidates',
    async (surface) => {
      const candidates = Array.from({ length: 1600 }, (_, index) => invalidSignature(index));
      candidates.push(`v1,${validSignature()}`);
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      const result = await runPublicSurface(surface, makeHeaders(candidates));

      expect(importKey).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[2]).toEqual(Uint8Array.from(Buffer.from(validSignature(), 'base64')));
      expectSuccessfulResult(surface, result);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s bounds cryptographic work when thousands of correctly sized signatures are invalid',
    async (surface) => {
      const candidates = Array.from({ length: 1600 }, (_, index) => invalidSignature(index));
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      await expectMismatch(surface, makeHeaders(candidates));

      expect(importKey).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s converts a bounded-provider verification rejection into the existing typed mismatch',
    async (surface) => {
      const headers = makeHeaders([
        ...Array.from({ length: 32 }, (_, index) => invalidSignature(index)),
        `v1,${validSignature()}`,
      ]);
      const providerError = new Error('synthetic bounded verification failure');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(providerError);

      await expectMismatch(surface, headers);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s preserves provider signing failures without treating them as signature mismatches',
    async (surface) => {
      const headers = makeHeaders([
        ...Array.from({ length: 32 }, (_, index) => invalidSignature(index)),
        `v1,${validSignature()}`,
      ]);
      const providerError = new Error('synthetic bounded signing failure');
      const sign = vi.spyOn(crypto.subtle, 'sign').mockRejectedValue(providerError);
      const verify = vi.spyOn(crypto.subtle, 'verify');

      await expect(runPublicSurface(surface, headers)).rejects.toBe(providerError);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s scans a very large rotation incrementally before accepting its final signature',
    async (surface) => {
      const signatures = Array.from({ length: 20_000 }, (_, index) => invalidSignature(index));
      signatures.push(`v1,${validSignature()}`);
      const headers = makeHeaders(signatures);
      const copiedBytes = vi.spyOn(Uint8Array, 'from');
      const originalSign = crypto.subtle.sign.bind(crypto.subtle);
      let copiesBeforeSigning = 0;
      const sign = vi.spyOn(crypto.subtle, 'sign').mockImplementation(async (algorithm, key, data) => {
        copiesBeforeSigning = copiedBytes.mock.calls.length;
        return await originalSign(algorithm, key, data);
      });
      const verify = vi.spyOn(crypto.subtle, 'verify');

      expectSuccessfulResult(surface, await runPublicSurface(surface, headers));
      expect(copiesBeforeSigning).toBeLessThanOrEqual(35);
      expect(copiedBytes.mock.calls.length).toBeLessThanOrEqual(35);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[2]).toEqual(Uint8Array.from(Buffer.from(validSignature(), 'base64')));
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s verifies a late large-header signature without requiring the Node Buffer global',
    async (surface) => {
      const headers = makeHeaders([
        ...Array.from({ length: 64 }, (_, index) => invalidSignature(index)),
        `v1,${validSignature()}`,
      ]);
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');
      vi.stubGlobal('Buffer', Buffer);
      Reflect.deleteProperty(globalThis, 'Buffer');

      expectSuccessfulResult(surface, await runPublicSurface(surface, headers));
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s rejects malformed, undersized, and oversized signatures before cryptography',
    async (surface) => {
      const signatures = [
        ...Array.from({ length: 32 }, (_, index) => `v1,not-valid-$$$${index}`),
        Buffer.alloc(31).toString('base64'),
        Buffer.alloc(33).toString('base64'),
        'A'.repeat(16_384),
      ];
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      await expectMismatch(surface, makeHeaders(signatures));

      expect(importKey).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s finds a late valid signature after malformed and oversized candidates',
    async (surface) => {
      const signatures = [
        ...Array.from({ length: 32 }, () => 'v1,not-valid-$$$'),
        'A'.repeat(16_384),
        `v1,${validSignature()}`,
      ];
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      const result = await runPublicSurface(surface, makeHeaders(signatures));

      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expectSuccessfulResult(surface, result);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s deduplicates repeated bare and prefixed signatures before finding a late match',
    async (surface) => {
      const duplicate = invalidSignature(7);
      const signatures = Array.from({ length: 2048 }, (_, index) =>
        index % 2 === 0 ? duplicate : `v1,${duplicate}`,
      );
      signatures.push(`v1,${validSignature()}`);
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      const result = await runPublicSurface(surface, makeHeaders(signatures));

      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expectSuccessfulResult(surface, result);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s bounds large-payload cryptographic work independently of signature count',
    async (surface) => {
      const largeEvent = { ...event, padding: 'x'.repeat(256 * 1024) };
      const largePayload = JSON.stringify(largeEvent);
      const signatures = Array.from({ length: 512 }, (_, index) => invalidSignature(index));
      signatures.push(`v1,${validSignature(String(now), largePayload)}`);
      const importKey = vi.spyOn(crypto.subtle, 'importKey');
      const sign = vi.spyOn(crypto.subtle, 'sign');
      const verify = vi.spyOn(crypto.subtle, 'verify');

      const result = await runPublicSurface(surface, makeHeaders(signatures), largePayload);

      expect(importKey).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(sign.mock.calls[0]?.[1]).toBe(verify.mock.calls[0]?.[1]);
      expect(sign.mock.calls[0]?.[2]).toBe(verify.mock.calls[0]?.[3]);
      expectSuccessfulResult(surface, result, largeEvent);
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
      expectSuccessfulResult(surface, result);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s continues through malformed signatures to a real rotated signature',
    async (surface) => {
      const result = await runPublicSurface(
        surface,
        makeHeaders(['v1,not-valid-$$$', `v1,${validSignature()}`]),
      );

      expectSuccessfulResult(surface, result);
    },
  );

  test.each(['verifySignature', 'unwrap'] as const)(
    '%s preserves short mocked signature compatibility',
    async (surface) => {
      const verify = vi.spyOn(crypto.subtle, 'verify').mockResolvedValueOnce(true);
      const result = await runPublicSurface(surface, makeHeaders(['v1,AA==']));

      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[2]).toEqual(Uint8Array.of(0));
      expectSuccessfulResult(surface, result);
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
