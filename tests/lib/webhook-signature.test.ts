import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import OpenAI, { InvalidWebhookSignatureError } from 'openai';

const now = 1_700_000_000;

interface FixtureOptions {
  payload?: string;
  timestamp?: string;
  webhookID?: string;
  secret?: string;
  prefix?: boolean;
}

function createFixture({
  payload = '{"id":"evt_test","type":"response.completed","data":{"id":"resp_test"}}',
  timestamp = String(now),
  webhookID = 'wh_test',
  secret = 'synthetic-webhook-secret',
  prefix = true,
}: FixtureOptions = {}) {
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice('whsec_'.length), 'base64') : secret;
  const signedPayload = webhookID ? `${webhookID}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
  const signature = createHmac('sha256', key).update(signedPayload).digest('base64');
  const headers = new Headers({
    'webhook-signature': prefix ? `v1,${signature}` : signature,
    'webhook-timestamp': timestamp,
    'webhook-id': webhookID,
  });
  return { payload, headers, secret, signedPayload };
}

function createClient() {
  return new OpenAI({ apiKey: 'test-key' });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webhook signature compatibility', () => {
  test.each([
    { name: 'old boundary', offset: -300, tolerance: undefined, error: undefined },
    { name: 'new boundary', offset: 300, tolerance: undefined, error: undefined },
    { name: 'past old boundary', offset: -301, tolerance: undefined, error: 'too old' },
    { name: 'past new boundary', offset: 301, tolerance: undefined, error: 'too new' },
    { name: 'zero tolerance', offset: 0, tolerance: 0, error: undefined },
    { name: 'zero tolerance past', offset: -1, tolerance: 0, error: 'too old' },
    { name: 'zero tolerance future', offset: 1, tolerance: 0, error: 'too new' },
    { name: 'negative tolerance', offset: 0, tolerance: -1, error: 'too old' },
    { name: 'NaN tolerance', offset: -100_000, tolerance: Number.NaN, error: undefined },
    { name: 'infinite tolerance', offset: 100_000, tolerance: Infinity, error: undefined },
    { name: 'JavaScript null tolerance', offset: 0, tolerance: null, error: undefined },
    { name: 'JavaScript null tolerance past', offset: -1, tolerance: null, error: 'too old' },
  ])('preserves the $name behavior', async ({ offset, tolerance, error }) => {
    const { payload, headers, secret } = createFixture({ timestamp: String(now + offset) });
    const result = createClient().webhooks.verifySignature(
      payload,
      headers,
      secret,
      tolerance as number | undefined,
    );

    if (error) {
      await expect(result).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
      await expect(result).rejects.toThrow(`Webhook timestamp is ${error}`);
    } else {
      await expect(result).resolves.toBeUndefined();
    }
  });

  test.each([`${now}.75`, `${now}suffix`, `+${now}`])(
    'parses the numeric timestamp prefix but signs the original header: %s',
    async (timestamp) => {
      const { payload, headers, secret } = createFixture({ timestamp });
      await expect(
        createClient().webhooks.verifySignature(payload, headers, secret),
      ).resolves.toBeUndefined();
    },
  );

  test('preserves signing without an empty webhook ID prefix', async () => {
    const { payload, headers, secret } = createFixture({ webhookID: '' });
    await expect(createClient().webhooks.verifySignature(payload, headers, secret)).resolves.toBeUndefined();
  });

  test.each([
    { name: 'raw secret and bare signature', secret: 'x', prefix: false },
    { name: 'prefixed secret and signature', secret: 'whsec_eA==', prefix: true },
  ])('preserves the existing $name format', async ({ secret, prefix }) => {
    const { payload, headers } = createFixture({ secret, prefix });
    await expect(createClient().webhooks.verifySignature(payload, headers, secret)).resolves.toBeUndefined();
  });

  test('propagates key-import errors unchanged', async () => {
    const { payload, headers, secret } = createFixture();
    const error = new Error('synthetic key-import failure');
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(error);
    const verify = vi.spyOn(crypto.subtle, 'verify');

    await expect(createClient().webhooks.verifySignature(payload, headers, secret)).rejects.toBe(error);
    expect(verify).not.toHaveBeenCalled();
  });

  test('tries signatures sequentially, reuses key and payload, and stops after a match', async () => {
    const { payload, headers, secret, signedPayload } = createFixture();
    headers.set('webhook-signature', 'v1,AA== v1,AQ== v1,Ag==');
    const verify = vi
      .spyOn(crypto.subtle, 'verify')
      .mockRejectedValueOnce(new Error('synthetic verification failure'))
      .mockResolvedValueOnce(true);
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(createClient().webhooks.verifySignature(payload, headers, secret)).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(2);
    const [first, second] = verify.mock.calls;
    expect(first?.[0]).toBe('HMAC');
    expect(first?.[2]).toEqual(Uint8Array.of(0));
    expect(second?.[2]).toEqual(Uint8Array.of(1));
    expect(first?.[1]).toBe(second?.[1]);
    expect(first?.[3]).toBe(second?.[3]);
    expect(second?.[3]).toEqual(new TextEncoder().encode(signedPayload));
    expect(logError).not.toHaveBeenCalled();
  });

  test('returns the typed mismatch error after every verification attempt fails', async () => {
    const { payload, headers, secret } = createFixture();
    headers.set('webhook-signature', 'v1,AA== v1,AQ==');
    const verify = vi
      .spyOn(crypto.subtle, 'verify')
      .mockRejectedValue(new Error('synthetic verification failure'));
    const result = createClient().webhooks.verifySignature(payload, headers, secret);

    await expect(result).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
    await expect(result).rejects.toThrow('The given webhook signature does not match the expected signature');
    expect(verify).toHaveBeenCalledTimes(2);
  });

  test('preserves capability, secret, header, and timestamp validation order', async () => {
    const client = createClient();
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      await expect(client.webhooks.verifySignature('{}', {}, null)).rejects.toThrow(
        'Webhook signature verification is only supported when the `crypto` global is defined',
      );
    } finally {
      if (cryptoDescriptor) {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'crypto');
      }
    }

    await expect(client.webhooks.verifySignature('{}', {}, null)).rejects.toThrow('The webhook secret must');
    await expect(client.webhooks.verifySignature('{}', {}, 'synthetic-secret')).rejects.toThrow(
      'Missing required header: webhook-signature',
    );

    const { payload, headers } = createFixture();
    headers.set('webhook-timestamp', 'invalid');
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    await expect(client.webhooks.verifySignature(payload, headers, 'whsec_%%%')).rejects.toThrow(
      'Invalid webhook timestamp format',
    );
    expect(importKey).not.toHaveBeenCalled();
  });

  test('unwrap still calls the resource override before parsing the payload', async () => {
    const client = new OpenAI({ apiKey: 'test-key', webhookSecret: 'configured-secret' });
    const headers = new Headers();
    const error = new Error('synthetic override failure');
    const verify = vi.spyOn(client.webhooks, 'verifySignature').mockRejectedValue(error);

    await expect(client.webhooks.unwrap('{', headers)).rejects.toBe(error);
    expect(verify).toHaveBeenCalledWith('{', headers, 'configured-secret', 300);
    verify.mockResolvedValue();
    await expect(client.webhooks.unwrap('{', headers)).rejects.toBeInstanceOf(SyntaxError);
  });

  test('retains the resource private-brand check for borrowed methods', async () => {
    const { payload, headers, secret } = createFixture();
    const verify = createClient().webhooks.verifySignature;

    await expect(Reflect.apply(verify, {}, [payload, headers, secret])).rejects.toBeInstanceOf(TypeError);
  });
});
