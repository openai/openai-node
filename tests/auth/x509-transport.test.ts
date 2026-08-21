import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Agent, ProxyAgent } from 'undici';
import { vi } from 'vitest';

import { createX509Transport } from 'openai/auth/x509-transport';
import type { X509Transport, X509TransportOptions } from 'openai/auth/x509-transport';
import { sendX509Request } from 'openai/internal/auth/x509-transport-capability';

import {
  closeObservedServers,
  createConnectProxy,
  createMutualTLSServer,
  createX509TestLab,
  listenLoopback,
} from '../utils/x509-test-lab';

function directOptions(dispatcher: Agent): X509TransportOptions {
  return {
    runtime: 'node',
    dispatcher,
    certificateIdentity: 'static',
    proxy: 'direct',
  };
}

describe('explicit X.509 transport capability', () => {
  test('creates an opaque, frozen capability with a distinct rotation generation', async () => {
    const dispatcher = new Agent();
    const rotatedDispatcher = new Agent();

    try {
      const first = createX509Transport(directOptions(dispatcher));
      const rotated = createX509Transport(directOptions(rotatedDispatcher));

      expect(Object.isFrozen(first)).toBe(true);
      expect(Reflect.ownKeys(first)).toEqual([]);
      expect(rotated).not.toBe(first);
    } finally {
      await Promise.all([dispatcher.close(), rotatedDispatcher.close()]);
    }
  });

  test.each([
    ['browser', 'browser'],
    ['Bun', 'bun'],
    ['Deno', 'deno'],
  ])('rejects an explicitly attested %s runtime', (_label, runtime) => {
    const dispatcher = new Agent();

    try {
      expect(() =>
        createX509Transport({ ...directOptions(dispatcher), runtime } as X509TransportOptions),
      ).toThrow(/Node\.js/iu);
    } finally {
      void dispatcher.close();
    }
  });

  test.each(['Bun', 'Deno'])('rejects a Node-compatibility shim for %s', (runtime) => {
    const dispatcher = new Agent();
    vi.stubGlobal(runtime, {});

    try {
      expect(() => createX509Transport(directOptions(dispatcher))).toThrow(/Node\.js/iu);
    } finally {
      vi.unstubAllGlobals();
      void dispatcher.close();
    }
  });

  test('rejects absent static-certificate attestation', () => {
    const dispatcher = new Agent();
    const options = directOptions(dispatcher);
    Object.defineProperty(options, 'certificateIdentity', { value: 'dynamic' });

    try {
      expect(() => createX509Transport(options)).toThrow(/static.*certificate/iu);
    } finally {
      void dispatcher.close();
    }
  });

  test('rejects opaque custom dispatchers without touching their methods', () => {
    const dispatch = vi.fn();
    const dispatcher = { dispatch } as unknown as Agent;

    expect(() => createX509Transport(directOptions(dispatcher))).toThrow(/Undici Agent or ProxyAgent/u);
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('rejects dispatcher proxies without evaluating traps', async () => {
    const dispatcher = new Agent();
    const trap = vi.fn(() => {
      throw new Error('dispatcher trap executed');
    });
    const opaqueDispatcher = new Proxy(dispatcher, { get: trap, getPrototypeOf: trap });

    try {
      expect(() => createX509Transport(directOptions(opaqueDispatcher))).toThrow(/proxy/iu);
      expect(trap).not.toHaveBeenCalled();
    } finally {
      await dispatcher.close();
    }
  });

  test('rejects configuration proxies without evaluating traps', async () => {
    const dispatcher = new Agent();
    const trap = vi.fn(() => {
      throw new Error('configuration trap executed');
    });
    const options = new Proxy(directOptions(dispatcher), { get: trap, ownKeys: trap });

    try {
      expect(() => createX509Transport(options)).toThrow(/proxy/iu);
      expect(trap).not.toHaveBeenCalled();
    } finally {
      await dispatcher.close();
    }
  });

  test('rejects executable configuration getters without invoking them', async () => {
    const dispatcher = new Agent();
    const getter = vi.fn(() => dispatcher);
    const options = {
      ...directOptions(dispatcher),
      get dispatcher() {
        return getter();
      },
    };

    try {
      expect(() => createX509Transport(options)).toThrow(/plain data/iu);
      expect(getter).not.toHaveBeenCalled();
    } finally {
      await dispatcher.close();
    }
  });

  test.each(['fetch', 'factory', 'tls', 'certificate', 'privateKey'])(
    'rejects unsupported %s input',
    async (key) => {
      const dispatcher = new Agent();

      try {
        expect(() => createX509Transport({ ...directOptions(dispatcher), [key]: () => {} })).toThrow(
          /unsupported.*option/iu,
        );
      } finally {
        await dispatcher.close();
      }
    },
  );

  test.each(['factory', 'tls', 'privateKey'])('rejects non-enumerable unsupported %s input', async (key) => {
    const dispatcher = new Agent();
    const options = directOptions(dispatcher);
    Object.defineProperty(options, key, { value: 'hidden transport option' });

    try {
      expect(() => createX509Transport(options)).toThrow(/unsupported.*option/iu);
    } finally {
      await dispatcher.close();
    }
  });

  test('rejects unsupported symbol-keyed transport options', async () => {
    const dispatcher = new Agent();
    const options = directOptions(dispatcher);
    Object.defineProperty(options, Symbol('privateKey'), { value: 'hidden transport option' });

    try {
      expect(() => createX509Transport(options)).toThrow(/unsupported.*option/iu);
    } finally {
      await dispatcher.close();
    }
  });

  test('rejects an Agent attested as a CONNECT proxy', async () => {
    const dispatcher = new Agent();

    try {
      expect(() => createX509Transport({ ...directOptions(dispatcher), proxy: 'http-connect' })).toThrow(
        /proxy.*ProxyAgent/iu,
      );
    } finally {
      await dispatcher.close();
    }
  });

  test('rejects forged capability objects before dispatch', async () => {
    await expect(
      sendX509Request({} as X509Transport, new URL('https://example.invalid'), {}),
    ).rejects.toThrow(/invalid.*transport/iu);
  });

  test('rejects plaintext destinations before dispatch', async () => {
    const dispatcher = new Agent();

    try {
      const capability = createX509Transport(directOptions(dispatcher));
      await expect(sendX509Request(capability, new URL('http://example.invalid'), {})).rejects.toThrow(
        /HTTPS/iu,
      );
    } finally {
      await dispatcher.close();
    }
  });

  test('rejects a URL that misreports HTTPS without leaking credentials to a plaintext server', async () => {
    const dispatcher = new Agent();
    let leakedAuthorization: string | undefined;
    const attacker = createServer((request, response) => {
      leakedAuthorization = request.headers.authorization;
      response.writeHead(200);
      response.end();
    });
    const listening = once(attacker, 'listening');
    attacker.listen(0, '127.0.0.1');
    await listening;

    try {
      const address = attacker.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a loopback TCP server address');
      }

      const target = new URL(`http://127.0.0.1:${address.port}`);
      Object.defineProperty(target, 'protocol', { get: () => 'https:' });
      const capability = createX509Transport(directOptions(dispatcher));

      await expect(
        sendX509Request(capability, target, { headers: { authorization: 'Bearer synthetic-secret' } }),
      ).rejects.toThrow(/HTTPS/iu);
      expect(leakedAuthorization).toBeUndefined();
    } finally {
      attacker.closeAllConnections();
      const closed = once(attacker, 'close');
      attacker.close();
      await Promise.all([dispatcher.close(), closed]);
    }
  });

  test('rejects per-request dispatcher overrides before dispatch', async () => {
    const dispatcher = new Agent();
    const override = new Agent();

    try {
      const capability = createX509Transport(directOptions(dispatcher));
      const options: RequestInit = {};
      Object.defineProperty(options, 'dispatcher', { value: override, enumerable: true });
      await expect(sendX509Request(capability, new URL('https://example.invalid'), options)).rejects.toThrow(
        /dispatcher.*override/iu,
      );
    } finally {
      await Promise.all([dispatcher.close(), override.close()]);
    }
  });

  test('snapshots the attested dispatcher and uses its static certificate on a real TLS request', async () => {
    const lab = createX509TestLab();
    const server = createMutualTLSServer(lab, (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
    const dispatcher = new Agent({
      connect: {
        ca: lab.certificateAuthority,
        cert: lab.firstClient.certificate,
        key: lab.firstClient.privateKey,
        servername: 'localhost',
      },
      maxCachedSessions: 0,
    });
    const replacement = new Agent({
      connect: {
        ca: lab.certificateAuthority,
        cert: lab.secondClient.certificate,
        key: lab.secondClient.privateKey,
        servername: 'localhost',
      },
      maxCachedSessions: 0,
    });

    try {
      const options = directOptions(dispatcher);
      const capability = createX509Transport(options);
      options.dispatcher = replacement;
      options.proxy = 'http-connect';
      const response = await sendX509Request(capability, await listenLoopback(server), {});
      await response.body?.cancel();

      expect(response.status).toBe(200);
      expect(server.requests[0]?.certificateFingerprint).toBe(
        new X509Certificate(lab.firstClient.certificate).fingerprint256,
      );
    } finally {
      await Promise.all([dispatcher.close(), replacement.close(), closeObservedServers(server)]);
    }
  });

  test('preserves inherited request method, headers, and body at native dispatch', async () => {
    const lab = createX509TestLab();
    let observedMethod: string | undefined;
    let observedAuthorization: string | undefined;
    let observedBody = '';
    const server = createMutualTLSServer(lab, (request, response) => {
      observedMethod = request.method;
      observedAuthorization = request.headers.authorization;
      request.setEncoding('utf-8');
      request.on('data', (chunk: string) => {
        observedBody += chunk;
      });
      request.once('end', () => {
        response.writeHead(200);
        response.end();
      });
    });
    const dispatcher = new Agent({
      connect: {
        ca: lab.certificateAuthority,
        cert: lab.firstClient.certificate,
        key: lab.firstClient.privateKey,
        servername: 'localhost',
      },
      maxCachedSessions: 0,
    });

    try {
      const inherited = {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic-secret' },
        body: 'inherited-request-body',
      };
      const options: RequestInit = Object.create(inherited);
      const capability = createX509Transport(directOptions(dispatcher));
      const response = await sendX509Request(capability, await listenLoopback(server), options);
      await response.body?.cancel();

      expect(observedMethod).toBe('POST');
      expect(observedAuthorization).toBe('Bearer synthetic-secret');
      expect(observedBody).toBe('inherited-request-body');
    } finally {
      await Promise.all([dispatcher.close(), closeObservedServers(server)]);
    }
  });

  test('preserves the original receiver for inherited private-field RequestInit accessors', async () => {
    const lab = createX509TestLab();
    let observedMethod: string | undefined;
    let observedAuthorization: string | undefined;
    let observedBody = '';
    const server = createMutualTLSServer(lab, (request, response) => {
      observedMethod = request.method;
      observedAuthorization = request.headers.authorization;
      request.setEncoding('utf-8');
      request.on('data', (chunk: string) => {
        observedBody += chunk;
      });
      request.once('end', () => {
        response.writeHead(200);
        response.end();
      });
    });
    const dispatcher = new Agent({
      connect: {
        ca: lab.certificateAuthority,
        cert: lab.firstClient.certificate,
        key: lab.firstClient.privateKey,
        servername: 'localhost',
      },
      maxCachedSessions: 0,
    });

    class PrivateRequestOptions {
      readonly #method = 'POST';
      readonly #headers = { authorization: 'Bearer synthetic-secret' };
      readonly #body = 'private-request-body';

      get method(): string {
        return this.#method;
      }

      get headers(): Record<string, string> {
        return this.#headers;
      }

      get body(): string {
        return this.#body;
      }
    }

    try {
      const options: RequestInit = new PrivateRequestOptions();
      const capability = createX509Transport(directOptions(dispatcher));
      const response = await sendX509Request(capability, await listenLoopback(server), options);
      await response.body?.cancel();

      expect(observedMethod).toBe('POST');
      expect(observedAuthorization).toBe('Bearer synthetic-secret');
      expect(observedBody).toBe('private-request-body');
    } finally {
      await Promise.all([dispatcher.close(), closeObservedServers(server)]);
    }
  });

  test('keeps HTTPS CONNECT proxy and workload identities separate on the wire', async () => {
    const lab = createX509TestLab();
    const target = createMutualTLSServer(lab, (_request, response) => {
      response.writeHead(200);
      response.end();
    });
    const proxy = createConnectProxy(lab, true);
    let dispatcher: ProxyAgent | undefined;

    try {
      const [targetURL, proxyURL] = await Promise.all([listenLoopback(target), listenLoopback(proxy)]);
      dispatcher = new ProxyAgent({
        uri: proxyURL.href,
        token: 'Basic cHJveHktY3JlZGVudGlhbA==',
        requestTls: {
          ca: lab.certificateAuthority,
          cert: lab.firstClient.certificate,
          key: lab.firstClient.privateKey,
          servername: 'localhost',
        },
        proxyTls: {
          ca: lab.proxyCertificateAuthority,
          cert: lab.proxyClient.certificate,
          key: lab.proxyClient.privateKey,
          servername: 'localhost',
        },
      });
      const capability = createX509Transport({
        runtime: 'node',
        dispatcher,
        certificateIdentity: 'static',
        proxy: 'https-connect',
      });

      const response = await sendX509Request(capability, targetURL, {});
      await response.body?.cancel();

      expect(response.status).toBe(200);
      expect(proxy.requests[0]?.certificateFingerprint).toBe(
        new X509Certificate(lab.proxyClient.certificate).fingerprint256,
      );
      expect(proxy.requests[0]?.proxyAuthorization).toBe('Basic cHJveHktY3JlZGVudGlhbA==');
      expect(target.requests[0]?.certificateFingerprint).toBe(
        new X509Certificate(lab.firstClient.certificate).fingerprint256,
      );
      expect(target.requests[0]?.proxyAuthorization).toBeUndefined();
    } finally {
      await Promise.all([dispatcher?.close(), closeObservedServers(target, proxy)]);
    }
  });
});
