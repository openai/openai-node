import { Agent } from 'undici';
import { expectTypeOf, vi } from 'vitest';

import OpenAI from 'openai';
import type { AzureClientOptions, AzureOpenAI, BedrockClientOptions, BedrockOpenAI } from 'openai';
import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';

let dispatcher: Agent;
let transport: X509Transport;

function configuredIdentity(configuration: Record<string, unknown> = {}) {
  return {
    type: 'x509' as const,
    identityProviderId: 'synthetic-configuration-provider',
    serviceAccountId: 'synthetic-configuration-account',
    ...configuration,
  };
}

function configuredClient(configuration: Record<string, unknown> = {}): OpenAI {
  return new OpenAI({
    apiKey: null,
    maxRetries: 0,
    workloadIdentity: configuredIdentity(configuration),
    x509Transport: transport,
  });
}

function mockExpiringCredential(): () => number {
  let exchanges = 0;
  vi.spyOn(transportCapability, 'sendX509Request').mockImplementation(async (_transport, url) => {
    if (url.origin === 'https://mtls.auth.openai.com') {
      exchanges += 1;
      return Response.json({
        access_token: `synthetic-configured-refresh-${exchanges}`,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        expires_in: 20,
      });
    }
    return Response.json({ data: [] });
  });
  return () => exchanges;
}

beforeEach(() => {
  dispatcher = new Agent();
  transport = createX509Transport({
    runtime: 'node',
    dispatcher,
    certificateIdentity: 'static',
    proxy: 'direct',
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await dispatcher.close();
});

describe('X.509 workload credential refresh configuration', () => {
  test('excludes X.509 credentials from provider constructors and client clones', () => {
    expectTypeOf<AzureClientOptions['credential']>().toEqualTypeOf<undefined>();
    expectTypeOf<BedrockClientOptions['credential']>().toEqualTypeOf<undefined>();
    expectTypeOf<
      NonNullable<ConstructorParameters<typeof AzureOpenAI>[0]>['credential']
    >().toEqualTypeOf<undefined>();
    expectTypeOf<
      NonNullable<ConstructorParameters<typeof BedrockOpenAI>[0]>['credential']
    >().toEqualTypeOf<undefined>();
    expectTypeOf<Parameters<AzureOpenAI['withOptions']>[0]['credential']>().toEqualTypeOf<undefined>();
    expectTypeOf<Parameters<BedrockOpenAI['withOptions']>[0]['credential']>().toEqualTypeOf<undefined>();
  });

  test.each([null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid refreshBufferSeconds %s before certificate presentation',
    (refreshBufferSeconds) => {
      const send = vi.spyOn(transportCapability, 'sendX509Request');

      expect(() => configuredClient({ refreshBufferSeconds })).toThrow(/refreshBufferSeconds/iu);
      expect(send).not.toHaveBeenCalled();
    },
  );

  test('rejects conflicting seconds and legacy milliseconds refresh options before authentication', () => {
    const send = vi.spyOn(transportCapability, 'sendX509Request');

    expect(() => configuredClient({ refreshBufferSeconds: 4, refreshBufferMs: 4000 })).toThrow(
      /refreshBufferSeconds.*refreshBufferMs|refreshBufferMs.*refreshBufferSeconds/iu,
    );
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    ['refreshBufferSeconds', 4],
    ['refreshBufferMs', 4000],
  ] as const)('honors the %s refresh option using its documented units', async (name, value) => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    const exchanges = mockExpiringCredential();
    const client = configuredClient({ [name]: value });

    await client.models.list();
    await vi.advanceTimersByTimeAsync(15_999);
    await client.models.list();
    expect(exchanges()).toBe(1);

    await vi.advanceTimersByTimeAsync(2);
    await client.models.list();
    expect(exchanges()).toBe(2);
  });

  test('preserves configured seconds-based refresh and cached credentials across client clones', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    const exchanges = mockExpiringCredential();
    const original = configuredClient({ refreshBufferSeconds: 4 });

    await original.models.list();
    await vi.advanceTimersByTimeAsync(15_999);
    await original.withOptions({ timeout: 2500 }).models.list();
    expect(exchanges()).toBe(1);

    await vi.advanceTimersByTimeAsync(2);
    await original.withOptions({ timeout: 2500 }).models.list();
    expect(exchanges()).toBe(2);
  });
});
