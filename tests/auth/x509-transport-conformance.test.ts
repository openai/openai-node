import { X509Certificate } from 'node:crypto';
import { Agent, ProxyAgent, fetch } from 'undici';
import { expect } from 'vitest';
import OpenAI from 'openai';

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
