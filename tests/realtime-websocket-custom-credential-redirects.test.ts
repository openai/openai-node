import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { vi } from 'vitest';

import OpenAI from 'openai';
import { protectWebSocketOptionsFromCredentialRedirects } from 'openai/internal/ws';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

const sensitiveTokenHeaders = [
  'X-Auth-Token',
  'x-aUtH-tOkEn',
  'X-Authentication-Token',
  'x-aUtHeNtIcAtIoN-tOkEn',
  'X_AUTHENTICATION_TOKEN',
  'X-AuthenticationToken',
  'Authentication-Token',
  'X-Authentication-Token-Primary',
  'X-Access-Token',
  'x_aCcEsS_tOkEn',
  'X-Session-Token',
  'X_SESSION_TOKEN',
  'X-Amz-Security-Token',
  'x-aMz-SeCuRiTy-ToKeN',
  'X_Amz_Security_Token',
  'Security-Token',
] as const;

const benignHeaders = [
  'X-Trace-Id',
  'X-Token-Budget',
  'X-Auth-Metadata',
  'X-Authentication-Metadata',
  'X-Access-Level',
  'X-Session-Id',
  'X-Security-Policy',
  'X-Auth-Tokenization',
  'X-Authentication-Tokenization',
] as const;

interface RedirectScenario {
  Responses: typeof StableResponsesWS | typeof BetaResponsesWS;
  header: string;
  sameOrigin?: boolean;
  status?: number;
  value?: string;
}

interface RedirectResult {
  destinationCredentials: (string | undefined)[];
  error: Error;
  publicErrors: Error[];
  redirects: number;
  sourceCredentials: (string | undefined)[];
}

async function closeServers(...servers: Server[]): Promise<void> {
  await Promise.all(
    servers.map(async (server) => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }),
  );
}

function onConnectionError(connection: unknown, listener: (error: Error) => void): void {
  (connection as { on: (event: 'error', callback: (error: Error) => void) => unknown }).on('error', listener);
}

async function inspectRedirect({
  Responses,
  header,
  sameOrigin = false,
  status = 302,
  value = 'SYNTHETIC_PRIVATE_CREDENTIAL',
}: RedirectScenario): Promise<RedirectResult> {
  const sourceCredentials: (string | undefined)[] = [];
  const destinationCredentials: (string | undefined)[] = [];
  let redirectURL = '';

  const destination = createServer((request, response) => {
    request.resume();
    destinationCredentials.push(request.headers[header.toLowerCase()] as string | undefined);
    response.writeHead(200);
    response.end();
  });

  const source = createServer((request, response) => {
    request.resume();
    if (request.url === '/same-origin-destination') {
      destinationCredentials.push(request.headers[header.toLowerCase()] as string | undefined);
      response.writeHead(200);
      response.end();
      return;
    }

    sourceCredentials.push(request.headers[header.toLowerCase()] as string | undefined);
    response.writeHead(status, { location: redirectURL });
    response.end();
  });

  await Promise.all([
    once(destination.listen(0, '127.0.0.1'), 'listening'),
    once(source.listen(0, '127.0.0.1'), 'listening'),
  ]);

  try {
    const destinationAddress = destination.address();
    const sourceAddress = source.address();
    if (
      !destinationAddress ||
      typeof destinationAddress === 'string' ||
      !sourceAddress ||
      typeof sourceAddress === 'string'
    ) {
      throw new Error('Expected both redirect test servers to bind ephemeral TCP ports');
    }

    redirectURL = sameOrigin
      ? `ws://127.0.0.1:${sourceAddress.port}/same-origin-destination`
      : `ws://127.0.0.1:${destinationAddress.port}/cross-origin-destination`;

    const client = new OpenAI({
      apiKey: null,
      adminAPIKey: 'admin-only',
      baseURL: `http://127.0.0.1:${sourceAddress.port}/v1`,
    });
    const connection = new Responses(client, {
      followRedirects: true,
      handshakeTimeout: 2000,
      headers: { [header]: value, 'X-Trace-Id': 'harmless-trace' },
    });
    const publicErrors: Error[] = [];
    const redirects = vi.fn();

    onConnectionError(connection, publicErrors.push.bind(publicErrors));
    connection.socket.platformSocket.on('redirect', redirects);

    const [error] = (await once(connection.socket.platformSocket, 'error')) as [Error];
    return {
      destinationCredentials,
      error,
      publicErrors,
      redirects: redirects.mock.calls.length,
      sourceCredentials,
    };
  } finally {
    await closeServers(source, destination);
  }
}

describe('WebSocket redirect credential-header classification', () => {
  test.each(sensitiveTokenHeaders)(
    'recognizes the credential header %s without mutating options',
    (header) => {
      const options = {
        followRedirects: true,
        handshakeTimeout: 4321,
        headers: { [header]: 'SYNTHETIC_PRIVATE_CREDENTIAL', 'X-Trace-Id': 'harmless-trace' },
      };

      const protectedOptions = protectWebSocketOptionsFromCredentialRedirects(options);

      expect(protectedOptions).toEqual({ ...options, followRedirects: false });
      expect(protectedOptions.headers).toBe(options.headers);
      expect(options.followRedirects).toBe(true);
    },
  );

  test.each(['Authorization', 'authorization', 'Proxy-Authorization', 'Cookie', 'X-API-Key', 'x_api_key'])(
    'preserves existing credential protection for %s',
    (header) => {
      const options = {
        followRedirects: true,
        handshakeTimeout: 4321,
        headers: { [header]: 'EXISTING_PRIVATE_CREDENTIAL' },
      };

      expect(protectWebSocketOptionsFromCredentialRedirects(options)).toEqual({
        ...options,
        followRedirects: false,
      });
    },
  );

  test.each(benignHeaders)('preserves credential-free redirect options for %s', (header) => {
    const options = {
      followRedirects: true,
      handshakeTimeout: 4321,
      headers: { [header]: 'ordinary-value' },
    };

    expect(protectWebSocketOptionsFromCredentialRedirects(options)).toBe(options);
  });

  test('preserves options identity when no headers are present', () => {
    const options = { followRedirects: true, handshakeTimeout: 4321 };

    expect(protectWebSocketOptionsFromCredentialRedirects(options)).toBe(options);
  });

  test('continues disabling redirects for explicit HTTP basic authentication', () => {
    const options = { auth: 'user:password', followRedirects: true };

    expect(protectWebSocketOptionsFromCredentialRedirects(options)).toEqual({
      ...options,
      followRedirects: false,
    });
  });
});

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name public Responses WebSocket credential redirects', ({ Responses }) => {
  test.each(sensitiveTokenHeaders)(
    'never forwards the %s credential to a different origin',
    async (header) => {
      const value = `SYNTHETIC_PRIVATE_${header}`;
      const result = await inspectRedirect({ Responses, header, value });

      expect(result.sourceCredentials).toEqual([value]);
      expect(result.destinationCredentials).toEqual([]);
      expect(result.redirects).toBe(1);
      expect(result.error.message).toBe('WebSocket was closed before the connection was established');
      expect(result.publicErrors).toEqual([
        expect.objectContaining({
          message: 'WebSocket was closed before the connection was established',
        }),
      ]);
    },
  );

  test.each([301, 302, 307, 308])(
    'blocks security-token disclosure across an HTTP %i redirect',
    async (status) => {
      const value = `SYNTHETIC_AWS_SESSION_TOKEN_${status}`;
      const result = await inspectRedirect({
        Responses,
        header: 'X-Amz-Security-Token',
        status,
        value,
      });

      expect(result.sourceCredentials).toEqual([value]);
      expect(result.destinationCredentials).toEqual([]);
      expect(result.redirects).toBe(1);
    },
  );

  test('applies existing credential-bearing redirect policy even to the same origin', async () => {
    const value = 'SYNTHETIC_SAME_ORIGIN_CREDENTIAL';
    const result = await inspectRedirect({
      Responses,
      header: 'X-Session-Token',
      sameOrigin: true,
      value,
    });

    expect(result.sourceCredentials).toEqual([value]);
    expect(result.destinationCredentials).toEqual([]);
    expect(result.redirects).toBe(1);
  });

  test.each([false, true])('preserves benign %s-origin redirect behavior', async (sameOrigin) => {
    const value = 'ordinary-nonsensitive-header-value';
    const result = await inspectRedirect({
      Responses,
      header: 'X-Token-Budget',
      sameOrigin,
      value,
    });

    expect(result.sourceCredentials).toEqual([value]);
    expect(result.destinationCredentials).toEqual([value]);
    expect(result.redirects).toBe(1);
    expect(result.error.message).toBe('Unexpected server response: 200');
  });
});
