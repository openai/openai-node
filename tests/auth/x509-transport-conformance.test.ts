import { X509Certificate } from 'node:crypto';
import { Agent, ProxyAgent, fetch } from 'undici';
import { expect } from 'vitest';
import OpenAI from 'openai';
import { createX509Transport, fromX509 } from 'openai/auth/x509-transport';
import { createProvider } from 'openai/internal/provider';

import {
  closeObservedServers,
  createConnectProxy,
  createMutualTLSServer,
  createX509TestLab,
  listenLoopback,
} from '../utils/x509-test-lab';
import type { ObservedServer, TestCertificate, X509TestLab } from '../utils/x509-test-lab';

const ACCESS_TOKEN = 'synthetic-workload-access-token';
const PROXY_AUTHORIZATION = 'Basic c3ludGhldGljLXByb3h5LWNyZWRlbnRpYWw=';

let lab: X509TestLab;

function createAgent(certificate: TestCertificate): Agent {
  return new Agent({
    connect: {
      ca: lab.certificateAuthority,
      cert: certificate.certificate,
      key: certificate.privateKey,
      servername: 'localhost',
    },
    maxCachedSessions: 0,
  });
}

function createProxyAgent(proxyURL: URL, encrypted: boolean): ProxyAgent {
  return new ProxyAgent({
    uri: proxyURL.href,
    token: PROXY_AUTHORIZATION,
    requestTls: {
      ca: lab.certificateAuthority,
      cert: lab.firstClient.certificate,
      key: lab.firstClient.privateKey,
      servername: 'localhost',
    },
    ...(encrypted
      ? {
          proxyTls: {
            ca: lab.proxyCertificateAuthority,
            cert: lab.proxyClient.certificate,
            key: lab.proxyClient.privateKey,
            servername: 'localhost',
          },
        }
      : {}),
  });
}

function createSDKClient(
  issuerURL: URL,
  apiURL: URL,
  dispatcher: Agent | ProxyAgent,
  issuerDispatcher: Agent | ProxyAgent = dispatcher,
): OpenAI {
  return new OpenAI({
    apiKey: null,
    baseURL: new URL('/v1', apiURL).href,
    maxRetries: 0,
    workloadIdentity: {
      identityProviderId: 'synthetic-identity-provider',
      serviceAccountId: 'synthetic-service-account',
      provider: {
        tokenType: 'jwt',
        getToken: async () => 'synthetic-subject-token',
      },
    },
    fetch: async (input, init) => {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (init?.redirect !== 'manual') {
        throw new Error('The SDK did not preserve its manual redirect policy');
      }
      if (target.href === 'https://auth.openai.com/oauth/token') {
        // Existing JWT exchange does not inherit client fetchOptions; bridge only its pinned test issuer.
        return fetch(new URL('/oauth/token', issuerURL), { ...init, dispatcher: issuerDispatcher });
      }
      if (!Object.is(init.dispatcher, dispatcher)) {
        throw new Error('The SDK did not propagate its configured fetchOptions dispatcher');
      }
      return fetch(target, { ...init, dispatcher });
    },
    fetchOptions: { dispatcher, redirect: 'manual' },
  });
}

function createTokenServer(): ObservedServer {
  return createMutualTLSServer(lab, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ access_token: ACCESS_TOKEN }));
  });
}

function createAPIServer(): ObservedServer {
  return createMutualTLSServer(lab, (request, response) => {
    if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
      response.writeHead(401);
      response.end();
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [] }));
  });
}

beforeAll(() => {
  lab = createX509TestLab();
});

describe('real-wire X.509 transport conformance', () => {
  test.each([
    { label: 'API key', options: { apiKey: 'synthetic-ordinary-api-key' } },
    { label: 'admin API key', options: { adminAPIKey: 'synthetic-ordinary-admin-key' } },
  ])('switches an SDK-owned certificate client to an ordinary $label', async ({ options }) => {
    const credential = fromX509({
      certificateChain: lab.firstClient.certificate.toString(),
      privateKey: lab.firstClient.privateKey.toString(),
      identityProviderId: 'synthetic-identity-provider',
      serviceAccountId: 'synthetic-service-account',
    });

    try {
      const original = new OpenAI({ credential });
      const clone = original.withOptions(options);

      expect(clone.baseURL).toBe('https://api.openai.com/v1');
      expect(clone.apiKey).toBe(options.apiKey ?? null);
      expect(clone.adminAPIKey).toBe(options.adminAPIKey ?? null);
      expect(original.baseURL).toBe('https://mtls.api.openai.com/v1');
    } finally {
      await credential.close();
    }
  });

  test.each([
    { label: 'without admin credentials', options: {} },
    { label: 'with separate admin credentials', options: { adminAPIKey: 'synthetic-admin-key' } },
  ])(
    'rejects replacing an owned X.509 identity $label without a replacement transport',
    async ({ options }) => {
      const credential = fromX509({
        certificateChain: lab.firstClient.certificate.toString(),
        privateKey: lab.firstClient.privateKey.toString(),
        identityProviderId: 'synthetic-identity-provider',
        serviceAccountId: 'synthetic-service-account',
      });

      try {
        const original = new OpenAI({ credential });

        expect(() =>
          original.withOptions({
            ...options,
            workloadIdentity: {
              type: 'x509',
              identityProviderId: 'replacement-identity-provider',
              serviceAccountId: 'replacement-service-account',
            },
          }),
        ).toThrow(/transport/iu);
        expect(original.baseURL).toBe('https://mtls.api.openai.com/v1');
      } finally {
        await credential.close();
      }
    },
  );

  test('retains owned credential isolation when an explicit undefined credential is inherited', async () => {
    const credential = fromX509({
      certificateChain: lab.firstClient.certificate.toString(),
      privateKey: lab.firstClient.privateKey.toString(),
      identityProviderId: 'synthetic-identity-provider',
      serviceAccountId: 'synthetic-service-account',
    });

    try {
      const inherited = new OpenAI({ credential }).withOptions({ credential: undefined });
      const ordinary = inherited.withOptions({ adminAPIKey: 'synthetic-admin-key' });

      expect(inherited.baseURL).toBe('https://mtls.api.openai.com/v1');
      expect(ordinary.baseURL).toBe('https://api.openai.com/v1');
    } finally {
      await credential.close();
    }
  });

  test('rejects an explicit null credential without downgrading owned transport isolation', async () => {
    const credential = fromX509({
      certificateChain: lab.firstClient.certificate.toString(),
      privateKey: lab.firstClient.privateKey.toString(),
      identityProviderId: 'synthetic-identity-provider',
      serviceAccountId: 'synthetic-service-account',
    });

    try {
      const original = new OpenAI({ credential });

      expect(() => Reflect.apply(original.withOptions, original, [{ credential: null }])).toThrow(
        /credential.*SDK|SDK.*credential/iu,
      );
      expect(original.baseURL).toBe('https://mtls.api.openai.com/v1');
    } finally {
      await credential.close();
    }
  });

  test('accepts an explicitly replaced X.509 identity and separately owned transport', async () => {
    const credential = fromX509({
      certificateChain: lab.firstClient.certificate.toString(),
      privateKey: lab.firstClient.privateKey.toString(),
      identityProviderId: 'synthetic-identity-provider',
      serviceAccountId: 'synthetic-service-account',
    });
    const replacementDispatcher = createAgent(lab.secondClient);
    const replacementTransport = createX509Transport({
      runtime: 'node',
      dispatcher: replacementDispatcher,
      certificateIdentity: 'static',
      proxy: 'direct',
    });

    try {
      const original = new OpenAI({ credential });
      const replacement = original.withOptions({
        workloadIdentity: {
          type: 'x509',
          identityProviderId: 'replacement-identity-provider',
          serviceAccountId: 'replacement-service-account',
        },
        x509Transport: replacementTransport,
      });

      expect(replacement.baseURL).toBe('https://mtls.api.openai.com/v1');
      expect(original.baseURL).toBe('https://mtls.api.openai.com/v1');
    } finally {
      await Promise.all([credential.close(), replacementDispatcher.close()]);
    }
  });

  test('switches an owned certificate client to an independently authenticated provider', async () => {
    const credential = fromX509({
      certificateChain: lab.firstClient.certificate.toString(),
      privateKey: lab.firstClient.privateKey.toString(),
      identityProviderId: 'synthetic-identity-provider',
      serviceAccountId: 'synthetic-service-account',
    });

    try {
      const original = new OpenAI({ credential });
      const provider = createProvider({
        configure: () => ({ name: 'synthetic-provider', baseURL: 'https://provider.example/v1' }),
      });
      const clone = original.withOptions({ provider });

      expect(clone.baseURL).toBe('https://provider.example/v1');
      expect(clone.apiKey).toBeNull();
      expect(original.baseURL).toBe('https://mtls.api.openai.com/v1');
    } finally {
      await credential.close();
    }
  });

  test.each([
    { label: 'without replacement query defaults', defaultQuery: undefined, search: '' },
    { label: 'with explicit replacement query defaults', defaultQuery: { page: '1' }, search: '?page=1' },
  ])(
    'switches an independently authenticated provider to an owned credential $label',
    async ({ defaultQuery, search }) => {
      const credential = fromX509({
        certificateChain: lab.firstClient.certificate.toString(),
        privateKey: lab.firstClient.privateKey.toString(),
        identityProviderId: 'synthetic-identity-provider',
        serviceAccountId: 'synthetic-service-account',
      });

      try {
        const provider = createProvider({
          configure: () => ({ name: 'synthetic-provider', baseURL: 'https://provider.example/v1' }),
        });
        const original = new OpenAI({
          provider,
          defaultQuery: { api_key: 'synthetic-provider-private-api-key' },
        });
        const clone = original.withOptions({
          credential,
          ...(defaultQuery === undefined ? {} : { defaultQuery }),
        });

        expect(clone.baseURL).toBe('https://mtls.api.openai.com/v1');
        expect(clone.apiKey).toBeNull();
        expect(clone.buildURL('/models', null)).toBe(`https://mtls.api.openai.com/v1/models${search}`);
        expect(original.baseURL).toBe('https://provider.example/v1');
        expect(original.buildURL('/models', null)).toBe(
          'https://provider.example/v1/models?api_key=synthetic-provider-private-api-key',
        );
      } finally {
        await credential.close();
      }
    },
  );

  test.each([
    { label: 'no proxy credentials', username: '', password: '', authorization: undefined },
    {
      label: 'username-only proxy credentials',
      username: 'synthetic-user',
      password: '',
      authorization: `Basic ${Buffer.from('synthetic-user:').toString('base64')}`,
    },
    {
      label: 'password-only proxy credentials',
      username: '',
      password: 'synthetic-password',
      authorization: `Basic ${Buffer.from(':synthetic-password').toString('base64')}`,
    },
    {
      label: 'percent-encoded proxy credentials',
      username: 'synthetic@example.com',
      password: 'synthetic:secret value',
      authorization: `Basic ${Buffer.from('synthetic@example.com:synthetic:secret value').toString('base64')}`,
    },
  ])(
    'authenticates both pinned X.509 endpoints with $label',
    async ({ username, password, authorization }) => {
      const exchangedBodies: string[] = [];
      const issuer = createMutualTLSServer(
        lab,
        (request, response) => {
          let body = '';
          request.setEncoding('utf-8');
          request.on('data', (chunk: string) => {
            body += chunk;
          });
          request.once('end', () => {
            exchangedBodies.push(body);
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(
              JSON.stringify({
                access_token: ACCESS_TOKEN,
                token_type: 'Bearer',
                issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
                expires_in: 3600,
              }),
            );
          });
        },
        lab.issuerServer,
      );
      const api = createMutualTLSServer(
        lab,
        (_request, response) => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: [] }));
        },
        lab.apiServer,
      );
      let proxy: ObservedServer | undefined;
      let credential: ReturnType<typeof fromX509> | undefined;

      try {
        const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
        proxy = createConnectProxy(
          lab,
          false,
          lab.proxyServer,
          new Map([
            ['mtls.auth.openai.com:443', issuerURL],
            ['mtls.api.openai.com:443', apiURL],
          ]),
        );
        const proxyURL = await listenLoopback(proxy, false);
        proxyURL.username = username;
        proxyURL.password = password;
        const trustRoots = [lab.certificateAuthority.toString()];
        credential = fromX509({
          certificateChain: lab.firstClient.certificate.toString(),
          privateKey: lab.firstClient.privateKey.toString(),
          identityProviderId: 'synthetic-identity-provider',
          serviceAccountId: 'synthetic-service-account',
          ca: trustRoots,
          proxy: { url: proxyURL, mode: 'http-connect' },
        });
        trustRoots[0] = lab.proxyCertificateAuthority.toString();
        const provider = createProvider({
          configure: () => ({ name: 'synthetic-provider', baseURL: 'https://provider.example/v1' }),
        });
        const client = new OpenAI({
          provider,
          defaultQuery: { api_key: 'synthetic-provider-private-api-key' },
        }).withOptions({ credential, maxRetries: 0 });

        await expect(client.models.list()).resolves.toMatchObject({ data: [] });

        expect(exchangedBodies).toHaveLength(1);
        expect(JSON.parse(exchangedBodies[0] ?? '')).toEqual({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:openai:params:oauth:token-type:x509',
          identity_provider_id: 'synthetic-identity-provider',
          service_account_id: 'synthetic-service-account',
        });
        const certificateFingerprint = new X509Certificate(lab.firstClient.certificate).fingerprint256;
        expect(issuer.requests).toEqual([
          expect.objectContaining({
            authority: 'mtls.auth.openai.com',
            authorization: undefined,
            certificateFingerprint,
            path: '/oauth/token',
            proxyAuthorization: undefined,
            serverName: 'mtls.auth.openai.com',
          }),
        ]);
        expect(api.requests).toEqual([
          expect.objectContaining({
            authority: 'mtls.api.openai.com',
            authorization: `Bearer ${ACCESS_TOKEN}`,
            certificateFingerprint,
            path: '/v1/models',
            proxyAuthorization: undefined,
            serverName: 'mtls.api.openai.com',
          }),
        ]);
        expect(proxy.requests).toEqual([
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: undefined,
            path: 'mtls.auth.openai.com:443',
            proxyAuthorization: authorization,
          }),
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: undefined,
            path: 'mtls.api.openai.com:443',
            proxyAuthorization: authorization,
          }),
        ]);
      } finally {
        await credential?.close();
        await closeObservedServers(issuer, api, ...(proxy ? [proxy] : []));
      }
    },
  );

  test.each(['issuer', 'API'] as const)(
    'rejects an untrusted $0 certificate before disclosing workload credentials',
    async (untrustedBoundary) => {
      const issuer = createMutualTLSServer(
        lab,
        (_request, response) => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              access_token: ACCESS_TOKEN,
              token_type: 'Bearer',
              issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
              expires_in: 3600,
            }),
          );
        },
        untrustedBoundary === 'issuer' ? lab.proxyServer : lab.issuerServer,
      );
      const api = createMutualTLSServer(
        lab,
        (_request, response) => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: [] }));
        },
        untrustedBoundary === 'API' ? lab.proxyServer : lab.apiServer,
      );
      let proxy: ObservedServer | undefined;
      let credential: ReturnType<typeof fromX509> | undefined;

      try {
        const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
        proxy = createConnectProxy(
          lab,
          false,
          lab.proxyServer,
          new Map([
            ['mtls.auth.openai.com:443', issuerURL],
            ['mtls.api.openai.com:443', apiURL],
          ]),
        );
        const proxyURL = await listenLoopback(proxy, false);
        credential = fromX509({
          certificateChain: lab.firstClient.certificate.toString(),
          privateKey: lab.firstClient.privateKey.toString(),
          identityProviderId: 'synthetic-identity-provider',
          serviceAccountId: 'synthetic-service-account',
          ca: lab.certificateAuthority.toString(),
          proxy: { url: proxyURL, mode: 'http-connect' },
        });
        const client = new OpenAI({ apiKey: null, credential, maxRetries: 0 });

        await expect(client.models.list()).rejects.toThrow();
        expect(issuer.requests).toHaveLength(untrustedBoundary === 'issuer' ? 0 : 1);
        expect(api.requests).toEqual([]);
      } finally {
        await credential?.close();
        await closeObservedServers(issuer, api, ...(proxy ? [proxy] : []));
      }
    },
  );

  test('observes one client certificate and isolated credentials on the issuer and API TLS handshakes', async () => {
    const issuer = createTokenServer();
    const api = createAPIServer();
    const dispatcher = createAgent(lab.firstClient);

    try {
      const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
      const client = createSDKClient(issuerURL, apiURL, dispatcher);

      const models = await client.models.list();
      expect(models.data).toEqual([]);
      const fingerprint = new X509Certificate(lab.firstClient.certificate).fingerprint256;
      expect(issuer.requests).toEqual([
        expect.objectContaining({
          authority: issuerURL.host,
          authorization: undefined,
          certificateFingerprint: fingerprint,
          cookie: undefined,
          path: '/oauth/token',
          proxyAuthorization: undefined,
        }),
      ]);
      expect(api.requests).toEqual([
        expect.objectContaining({
          authority: apiURL.host,
          authorization: `Bearer ${ACCESS_TOKEN}`,
          certificateFingerprint: fingerprint,
          path: '/v1/models',
          proxyAuthorization: undefined,
        }),
      ]);
    } finally {
      await dispatcher.close();
      await closeObservedServers(issuer, api);
    }
  });

  test('rejects a TLS request without an enrolled client certificate before the application sees it', async () => {
    const issuer = createTokenServer();
    const dispatcher = new Agent({ connect: { ca: lab.certificateAuthority, servername: 'localhost' } });

    try {
      const issuerURL = await listenLoopback(issuer);
      const client = createSDKClient(issuerURL, issuerURL, dispatcher);

      await expect(client.models.list()).rejects.toThrow();
      expect(issuer.requests).toEqual([]);
    } finally {
      await dispatcher.close();
      await closeObservedServers(issuer);
    }
  });

  test('rejects a proxy-only client certificate at the workload issuer trust boundary', async () => {
    const issuer = createTokenServer();
    const dispatcher = createAgent(lab.proxyClient);

    try {
      const issuerURL = await listenLoopback(issuer);
      const client = createSDKClient(issuerURL, issuerURL, dispatcher);

      await expect(client.models.list()).rejects.toThrow();
      expect(issuer.requests).toEqual([]);
    } finally {
      await dispatcher.close();
      await closeObservedServers(issuer);
    }
  });

  test('rejects a workload-signed HTTPS proxy before disclosing CONNECT credentials', async () => {
    const issuer = createTokenServer();
    const api = createAPIServer();
    const proxy = createConnectProxy(lab, true, lab.server);
    let dispatcher: ProxyAgent | undefined;

    try {
      const [issuerURL, apiURL, proxyURL] = await Promise.all([
        listenLoopback(issuer),
        listenLoopback(api),
        listenLoopback(proxy),
      ]);
      dispatcher = createProxyAgent(proxyURL, true);
      const client = createSDKClient(issuerURL, apiURL, dispatcher);

      await expect(client.models.list()).rejects.toThrow();
      expect(proxy.requests).toEqual([]);
      expect(issuer.requests).toEqual([]);
      expect(api.requests).toEqual([]);
    } finally {
      await dispatcher?.close();
      await closeObservedServers(issuer, api, proxy);
    }
  });

  test('demonstrates that an ordinary bearer remains transferable between distinct enrolled certificates', async () => {
    const issuer = createTokenServer();
    const api = createAPIServer();
    const firstIdentity = createAgent(lab.firstClient);
    const secondIdentity = createAgent(lab.secondClient);

    try {
      const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
      const client = createSDKClient(issuerURL, apiURL, secondIdentity, firstIdentity);

      const models = await client.models.list();
      expect(models.data).toEqual([]);
      expect(issuer.requests[0]?.certificateFingerprint).toBe(
        new X509Certificate(lab.firstClient.certificate).fingerprint256,
      );
      expect(api.requests[0]?.certificateFingerprint).toBe(
        new X509Certificate(lab.secondClient.certificate).fingerprint256,
      );
      expect(issuer.requests[0]?.certificateFingerprint).not.toBe(api.requests[0]?.certificateFingerprint);
    } finally {
      await Promise.all([firstIdentity.close(), secondIdentity.close()]);
      await closeObservedServers(issuer, api);
    }
  });

  test('refuses an mTLS redirect before the destination receives a certificate or bearer', async () => {
    const issuer = createTokenServer();
    const destination = createAPIServer();
    let destinationURL: URL;
    const source = createMutualTLSServer(lab, (_request, response) => {
      response.writeHead(307, { Location: new URL('/capture', destinationURL).href });
      response.end();
    });
    const dispatcher = createAgent(lab.firstClient);

    try {
      const [issuerURL, redirectDestinationURL, sourceURL] = await Promise.all([
        listenLoopback(issuer),
        listenLoopback(destination),
        listenLoopback(source),
      ]);
      destinationURL = redirectDestinationURL;
      const client = createSDKClient(issuerURL, sourceURL, dispatcher);

      await expect(client.models.list()).rejects.toMatchObject({ status: 307 });
      expect(source.requests).toHaveLength(1);
      expect(destination.requests).toEqual([]);
    } finally {
      await dispatcher.close();
      await closeObservedServers(issuer, source, destination);
    }
  });

  test.each([
    { label: 'HTTP CONNECT', encrypted: false },
    { label: 'HTTPS CONNECT', encrypted: true },
  ])(
    'keeps workload certificates and bearer tokens off the $label proxy handshake',
    async ({ encrypted }) => {
      const issuer = createTokenServer();
      const api = createAPIServer();
      const proxy = createConnectProxy(lab, encrypted);
      let dispatcher: ProxyAgent | undefined;

      try {
        const [issuerURL, apiURL, proxyURL] = await Promise.all([
          listenLoopback(issuer),
          listenLoopback(api),
          listenLoopback(proxy, encrypted),
        ]);
        dispatcher = createProxyAgent(proxyURL, encrypted);

        const client = createSDKClient(issuerURL, apiURL, dispatcher);

        const models = await client.models.list();
        expect(models.data).toEqual([]);
        expect(proxy.requests).toEqual([
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: encrypted
              ? new X509Certificate(lab.proxyClient.certificate).fingerprint256
              : undefined,
            cookie: undefined,
            path: issuerURL.host,
            proxyAuthorization: PROXY_AUTHORIZATION,
          }),
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: encrypted
              ? new X509Certificate(lab.proxyClient.certificate).fingerprint256
              : undefined,
            cookie: undefined,
            path: apiURL.host,
            proxyAuthorization: PROXY_AUTHORIZATION,
          }),
        ]);
        expect(issuer.requests).toEqual([
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: new X509Certificate(lab.firstClient.certificate).fingerprint256,
            proxyAuthorization: undefined,
          }),
        ]);
        expect(api.requests).toEqual([
          expect.objectContaining({
            authorization: `Bearer ${ACCESS_TOKEN}`,
            certificateFingerprint: new X509Certificate(lab.firstClient.certificate).fingerprint256,
            proxyAuthorization: undefined,
          }),
        ]);
      } finally {
        await dispatcher?.close();
        await closeObservedServers(issuer, api, proxy);
      }
    },
  );
});
