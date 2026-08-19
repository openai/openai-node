import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHTTPServer } from 'node:http';
import type { IncomingMessage, Server as HTTPServer, ServerResponse } from 'node:http';
import { createServer as createHTTPSServer } from 'node:https';
import type { Server as HTTPSServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';

const runOpenSSL = promisify(execFile);

export interface TestCertificate {
  certificate: Buffer;
  privateKey: Buffer;
}

export interface X509TestLab {
  certificateAuthority: Buffer;
  server: TestCertificate;
  firstClient: TestCertificate;
  secondClient: TestCertificate;
  cleanup: () => Promise<void>;
}

export interface ObservedRequest {
  authority: string | undefined;
  authorization: string | undefined;
  certificateFingerprint: string | undefined;
  cookie: string | undefined;
  path: string | undefined;
  proxyAuthorization: string | undefined;
}

export interface ObservedServer {
  server: HTTPServer | HTTPSServer;
  requests: ObservedRequest[];
  connections: Set<Duplex>;
}

async function issueCertificate(
  directory: string,
  name: string,
  extensions: string[],
): Promise<TestCertificate> {
  await runOpenSSL(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.csr`,
      '-subj',
      `/CN=${name}`,
      ...extensions.flatMap((extension) => ['-addext', extension]),
    ],
    { cwd: directory, windowsHide: true },
  );
  await runOpenSSL(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      `${name}.csr`,
      '-CA',
      'ca.crt',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${name}.crt`,
      '-days',
      '1',
      '-copy_extensions',
      'copy',
    ],
    { cwd: directory, windowsHide: true },
  );

  const [certificate, privateKey] = await Promise.all([
    readFile(path.join(directory, `${name}.crt`)),
    readFile(path.join(directory, `${name}.key`)),
  ]);
  return { certificate, privateKey };
}

export async function createX509TestLab(): Promise<X509TestLab> {
  const directory = await mkdtemp(path.join(tmpdir(), 'openai-x509-conformance-'));

  try {
    await runOpenSSL(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-keyout',
        'ca.key',
        '-out',
        'ca.crt',
        '-days',
        '1',
        '-subj',
        '/CN=OpenAI SDK ephemeral test certificate authority',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
      ],
      { cwd: directory, windowsHide: true },
    );

    const server = await issueCertificate(directory, 'localhost', [
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      'extendedKeyUsage=serverAuth',
    ]);
    const firstClient = await issueCertificate(directory, 'workload-a', ['extendedKeyUsage=clientAuth']);
    const secondClient = await issueCertificate(directory, 'workload-b', ['extendedKeyUsage=clientAuth']);

    return {
      certificateAuthority: await readFile(path.join(directory, 'ca.crt')),
      server,
      firstClient,
      secondClient,
      cleanup: async () => {
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function observeRequest(request: IncomingMessage): ObservedRequest {
  const socket = request.socket as Partial<TLSSocket>;
  return {
    authority: request.headers.host,
    authorization: request.headers.authorization,
    certificateFingerprint: socket.getPeerCertificate?.().fingerprint256,
    cookie: request.headers.cookie,
    path: request.url,
    proxyAuthorization: request.headers['proxy-authorization'],
  };
}

export function createMutualTLSServer(
  lab: X509TestLab,
  respond: (request: IncomingMessage, response: ServerResponse) => void,
): ObservedServer {
  const requests: ObservedRequest[] = [];
  const server = createHTTPSServer(
    {
      ca: lab.certificateAuthority,
      cert: lab.server.certificate,
      key: lab.server.privateKey,
      requestCert: true,
      rejectUnauthorized: true,
    },
    (request, response) => {
      requests.push(observeRequest(request));
      respond(request, response);
    },
  );

  return { server, requests, connections: new Set() };
}

export function createConnectProxy(lab: X509TestLab, encrypted: boolean): ObservedServer {
  const requests: ObservedRequest[] = [];
  const connections = new Set<Duplex>();
  const server = encrypted
    ? createHTTPSServer({
        ca: lab.certificateAuthority,
        cert: lab.server.certificate,
        key: lab.server.privateKey,
        requestCert: true,
        rejectUnauthorized: true,
      })
    : createHTTPServer();

  server.on('connect', (request, downstream, head) => {
    requests.push(observeRequest(request));
    const target = new URL(`https://${request.url}`);
    if (target.hostname !== '127.0.0.1') {
      downstream.destroy();
      return;
    }

    const upstream = connect({ host: target.hostname, port: Number(target.port) });
    connections.add(downstream);
    connections.add(upstream);
    downstream.once('close', () => connections.delete(downstream));
    upstream.once('close', () => connections.delete(upstream));
    downstream.once('error', () => upstream.destroy());
    upstream.once('error', () => downstream.destroy());
    upstream.once('connect', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      downstream.pipe(upstream).pipe(downstream);
    });
  });

  return { server, requests, connections };
}

export async function listenLoopback(observed: ObservedServer, encrypted = true): Promise<URL> {
  const listening = once(observed.server, 'listening');
  observed.server.listen(0, '127.0.0.1');
  await listening;

  const address = observed.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a loopback TCP server address');
  }

  return new URL(`${encrypted ? 'https' : 'http'}://127.0.0.1:${address.port}`);
}

export async function closeObservedServers(...observedServers: ObservedServer[]): Promise<void> {
  await Promise.all(
    observedServers.map(async ({ server, connections }) => {
      for (const connection of connections) {
        connection.destroy();
      }
      if (!server.listening) {
        return;
      }

      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }),
  );
}
