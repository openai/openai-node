import { X509Certificate } from 'node:crypto';
import { Agent, ProxyAgent, fetch } from 'undici';
import { expect } from 'vitest';

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

beforeAll(async () => {
  lab = await createX509TestLab();
});

afterAll(async () => {
  await lab?.cleanup();
});

describe('real-wire X.509 transport conformance', () => {
  test('observes one client certificate and isolated credentials on the issuer and API TLS handshakes', async () => {
    const issuer = createTokenServer();
    const api = createAPIServer();
    const dispatcher = createAgent(lab.firstClient);

    try {
      const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
      const tokenResponse = await fetch(new URL('/oauth/token', issuerURL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        redirect: 'manual',
        dispatcher,
      });
      expect(await tokenResponse.json()).toEqual({ access_token: ACCESS_TOKEN });

      const apiResponse = await fetch(new URL('/v1/models', apiURL), {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        redirect: 'manual',
        dispatcher,
      });

      expect(apiResponse.status).toBe(200);
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

      await expect(fetch(new URL('/oauth/token', issuerURL), { dispatcher })).rejects.toThrow();
      expect(issuer.requests).toEqual([]);
    } finally {
      await dispatcher.close();
      await closeObservedServers(issuer);
    }
  });

  test('demonstrates that an ordinary bearer remains transferable between distinct enrolled certificates', async () => {
    const issuer = createTokenServer();
    const api = createAPIServer();
    const firstIdentity = createAgent(lab.firstClient);
    const secondIdentity = createAgent(lab.secondClient);

    try {
      const [issuerURL, apiURL] = await Promise.all([listenLoopback(issuer), listenLoopback(api)]);
      const exchange = await fetch(new URL('/oauth/token', issuerURL), {
        method: 'POST',
        dispatcher: firstIdentity,
      });
      expect(await exchange.json()).toEqual({ access_token: ACCESS_TOKEN });

      const response = await fetch(new URL('/v1/models', apiURL), {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        dispatcher: secondIdentity,
      });

      expect(response.status).toBe(200);
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
    const destination = createAPIServer();
    let destinationURL: URL;
    const source = createMutualTLSServer(lab, (_request, response) => {
      response.writeHead(307, { Location: new URL('/capture', destinationURL).href });
      response.end();
    });
    const dispatcher = createAgent(lab.firstClient);

    try {
      const endpoints = await Promise.all([listenLoopback(destination), listenLoopback(source)]);
      [destinationURL] = endpoints;

      const response = await fetch(new URL('/v1/models', endpoints[1]), {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        redirect: 'manual',
        dispatcher,
      });

      expect(response.status).toBe(307);
      expect(source.requests).toHaveLength(1);
      expect(destination.requests).toEqual([]);
    } finally {
      await dispatcher.close();
      await closeObservedServers(source, destination);
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
        dispatcher = new ProxyAgent({
          uri: proxyURL.href,
          token: PROXY_AUTHORIZATION,
          requestTls: {
            ca: lab.certificateAuthority,
            cert: lab.firstClient.certificate,
            key: lab.firstClient.privateKey,
            servername: 'localhost',
          },
          ...(encrypted ? { proxyTls: { ca: lab.certificateAuthority, servername: 'localhost' } } : {}),
        });

        const exchange = await fetch(new URL('/oauth/token', issuerURL), {
          method: 'POST',
          dispatcher,
        });
        expect(await exchange.json()).toEqual({ access_token: ACCESS_TOKEN });

        const response = await fetch(new URL('/v1/models', apiURL), {
          headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
          dispatcher,
        });

        expect(response.status).toBe(200);
        expect(proxy.requests).toEqual([
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: undefined,
            cookie: undefined,
            path: issuerURL.host,
            proxyAuthorization: PROXY_AUTHORIZATION,
          }),
          expect.objectContaining({
            authorization: undefined,
            certificateFingerprint: undefined,
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
