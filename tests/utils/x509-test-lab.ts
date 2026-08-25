import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHTTPServer } from 'node:http';
import type { IncomingMessage, Server as HTTPServer, ServerResponse } from 'node:http';
import { createServer as createHTTPSServer } from 'node:https';
import type { Server as HTTPSServer } from 'node:https';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';

export interface TestCertificate {
  certificate: Buffer;
  privateKey: Buffer;
}

export interface X509TestLab {
  certificateAuthority: Buffer;
  proxyCertificateAuthority: Buffer;
  server: TestCertificate;
  issuerServer: TestCertificate;
  apiServer: TestCertificate;
  proxyServer: TestCertificate;
  firstClient: TestCertificate;
  secondClient: TestCertificate;
  proxyClient: TestCertificate;
}

export interface ObservedRequest {
  authority: string | undefined;
  authorization: string | undefined;
  certificateFingerprint: string | undefined;
  cookie: string | undefined;
  path: string | undefined;
  proxyAuthorization: string | undefined;
  serverName: string | undefined;
}

export interface ObservedServer {
  server: HTTPServer | HTTPSServer;
  requests: ObservedRequest[];
  connections: Set<Duplex>;
}

interface SigningIdentity extends TestCertificate {
  name: string;
  signingKey: KeyObject;
}

function encodeDER(tag: number, value: Buffer): Buffer {
  if (value.length < 128) {
    return Buffer.concat([Buffer.from([tag, value.length]), value]);
  }

  const bytes: number[] = [];
  for (let remaining = value.length; remaining > 0; remaining = Math.floor(remaining / 256)) {
    bytes.unshift(remaining % 256);
  }
  return Buffer.concat([Buffer.from([tag, 0x80 + bytes.length, ...bytes]), value]);
}

function sequence(...values: Buffer[]): Buffer {
  return encodeDER(0x30, Buffer.concat(values));
}

function objectIdentifier(value: number[]): Buffer {
  return encodeDER(0x06, Buffer.from(value));
}

function distinguishedName(name: string): Buffer {
  const commonName = sequence(objectIdentifier([0x55, 0x04, 0x03]), encodeDER(0x0c, Buffer.from(name)));
  return sequence(encodeDER(0x31, commonName));
}

function utcTime(date: Date): Buffer {
  const timestamp = date.toISOString();
  const value = `${timestamp.slice(2, 4)}${timestamp.slice(5, 7)}${timestamp.slice(8, 10)}${timestamp.slice(11, 13)}${timestamp.slice(14, 16)}${timestamp.slice(17, 19)}Z`;
  return encodeDER(0x17, Buffer.from(value));
}

function extension(identifier: number[], value: Buffer, critical = false): Buffer {
  return sequence(
    objectIdentifier(identifier),
    ...(critical ? [encodeDER(0x01, Buffer.from([0xff]))] : []),
    encodeDER(0x04, value),
  );
}

function issueCertificate(
  name: string,
  purpose: 'authority' | 'server' | 'client',
  issuer?: SigningIdentity,
): SigningIdentity {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signatureAlgorithm = sequence(objectIdentifier([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
  const isAuthority = purpose === 'authority';
  const extensions = [
    extension(
      [0x55, 0x1d, 0x13],
      sequence(...(isAuthority ? [encodeDER(0x01, Buffer.from([0xff]))] : [])),
      true,
    ),
    extension(
      [0x55, 0x1d, 0x0f],
      encodeDER(0x03, Buffer.from(isAuthority ? [0x01, 0x06] : [0x07, 0x80])),
      true,
    ),
  ];

  if (!isAuthority) {
    const keyPurpose = [0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, purpose === 'server' ? 0x01 : 0x02];
    extensions.push(extension([0x55, 0x1d, 0x25], sequence(objectIdentifier(keyPurpose))));
  }
  if (purpose === 'server') {
    const names = [encodeDER(0x82, Buffer.from(name))];
    if (name === 'localhost') {
      names.push(encodeDER(0x87, Buffer.from([127, 0, 0, 1])));
    }
    extensions.push(extension([0x55, 0x1d, 0x11], sequence(...names)));
  }

  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) % 128 || 1;
  const now = Date.now();
  const certificateBody = sequence(
    encodeDER(0xa0, encodeDER(0x02, Buffer.from([0x02]))),
    encodeDER(0x02, serial),
    signatureAlgorithm,
    distinguishedName(issuer?.name ?? name),
    sequence(utcTime(new Date(now - 60_000)), utcTime(new Date(now + 86_400_000))),
    distinguishedName(name),
    keys.publicKey.export({ format: 'der', type: 'spki' }),
    encodeDER(0xa3, sequence(...extensions)),
  );
  const signature = sign('sha256', certificateBody, issuer?.signingKey ?? keys.privateKey);
  const certificateDER = sequence(
    certificateBody,
    signatureAlgorithm,
    encodeDER(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const certificateBase64 = certificateDER
    .toString('base64')
    .match(/.{1,64}/gu)
    ?.join('\n');

  return {
    name,
    certificate: Buffer.from(
      `-----BEGIN CERTIFICATE-----\n${certificateBase64}\n-----END CERTIFICATE-----\n`,
    ),
    privateKey: Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })),
    signingKey: keys.privateKey,
  };
}

export function createX509TestLab(): X509TestLab {
  const workloadAuthority = issueCertificate('OpenAI SDK ephemeral workload test authority', 'authority');
  const proxyAuthority = issueCertificate('OpenAI SDK ephemeral proxy test authority', 'authority');

  return {
    certificateAuthority: workloadAuthority.certificate,
    proxyCertificateAuthority: proxyAuthority.certificate,
    server: issueCertificate('localhost', 'server', workloadAuthority),
    issuerServer: issueCertificate('mtls.auth.openai.com', 'server', workloadAuthority),
    apiServer: issueCertificate('mtls.api.openai.com', 'server', workloadAuthority),
    proxyServer: issueCertificate('localhost', 'server', proxyAuthority),
    firstClient: issueCertificate('workload-a', 'client', workloadAuthority),
    secondClient: issueCertificate('workload-b', 'client', workloadAuthority),
    proxyClient: issueCertificate('proxy-only', 'client', proxyAuthority),
  };
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
    serverName: typeof socket.servername === 'string' ? socket.servername : undefined,
  };
}

export function createMutualTLSServer(
  lab: X509TestLab,
  respond: (request: IncomingMessage, response: ServerResponse) => void,
  certificate: TestCertificate = lab.server,
): ObservedServer {
  const requests: ObservedRequest[] = [];
  const server = createHTTPSServer(
    {
      ca: lab.certificateAuthority,
      cert: certificate.certificate,
      key: certificate.privateKey,
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

export function createConnectProxy(
  lab: X509TestLab,
  encrypted: boolean,
  serverCertificate: TestCertificate = lab.proxyServer,
  routes?: ReadonlyMap<string, URL>,
): ObservedServer {
  const requests: ObservedRequest[] = [];
  const connections = new Set<Duplex>();
  const server = encrypted
    ? createHTTPSServer({
        ca: lab.proxyCertificateAuthority,
        cert: serverCertificate.certificate,
        key: serverCertificate.privateKey,
        requestCert: true,
        rejectUnauthorized: true,
      })
    : createHTTPServer();

  server.on('connect', (request, downstream, head) => {
    requests.push(observeRequest(request));
    const target = new URL(`https://${request.url}`);
    const destination = routes?.get(request.url ?? '') ?? target;
    if (destination.hostname !== '127.0.0.1') {
      downstream.destroy();
      return;
    }

    const upstream = connect({ host: destination.hostname, port: Number(destination.port) });
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
