/* oxlint-disable eslint/max-classes-per-file -- These subclasses cover the independent credential and transport hook contracts. */
import { once } from 'node:events';
import { createServer } from 'node:https';
import { setImmediate } from 'node:timers/promises';
import { vi } from 'vitest';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';
import { createX509TestLab } from './utils/x509-test-lab';

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses reconnect credentials on real upgrades', ({ Responses }) => {
  test('uses the newer successful HTTP credential for the next synchronous WebSocket', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing local server address');
    }
    const resolutions: ((key: string) => void)[] = [];
    const apiKey = vi.fn(
      () =>
        // oxlint-disable-next-line promise/avoid-new -- Exercise HTTP provider resolution in reverse order.
        new Promise<string>((resolve) => {
          resolutions.push(resolve);
        }),
    );
    const client = new OpenAI({
      apiKey,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      fetch: async (_url, init) =>
        Response.json({ authorization: new Headers(init?.headers).get('authorization') }),
    });
    const first = client.get<{ authorization: string }>('/first');
    const second = client.get<{ authorization: string }>('/second');
    await vi.waitFor(() => expect(resolutions).toHaveLength(2));
    const [resolveFirst, resolveSecond] = resolutions;
    if (!resolveFirst || !resolveSecond) {
      throw new Error('Expected both HTTP credential providers');
    }
    try {
      resolveSecond('synthetic-newer');
      await expect(second).resolves.toEqual({ authorization: 'Bearer synthetic-newer' });
      resolveFirst('synthetic-older');
      await expect(first).resolves.toEqual({ authorization: 'Bearer synthetic-older' });
      const incoming = once(server, 'connection');
      const connection = new Responses(client);
      try {
        const [, request] = await incoming;
        await once(connection.socket.platformSocket, 'open');
        expect(request.headers.authorization).toBe('Bearer synthetic-newer');
        expect(apiKey).toHaveBeenCalledTimes(2);
      } finally {
        connection.close();
      }
    } finally {
      resolveFirst('synthetic-older');
      resolveSecond('synthetic-newer');
      for (const peer of server.clients) {
        peer.terminate();
      }
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });

  test.each([
    { name: 'absent', headers: {}, defaultHeaders: {}, authorization: undefined, needsRefresh: true },
    {
      name: 'socket X-Request-ID',
      headers: { 'X-Request-ID': 'synthetic-socket-request' },
      defaultHeaders: {},
      authorization: undefined,
      needsRefresh: true,
    },
    {
      name: 'client default X-Request-ID',
      headers: {},
      defaultHeaders: { 'X-Request-ID': 'synthetic-client-request' },
      authorization: undefined,
      needsRefresh: true,
    },
    {
      name: 'socket X-Client-Request-ID',
      headers: { 'X-Client-Request-ID': 'synthetic-client-request' },
      defaultHeaders: {},
      authorization: undefined,
      needsRefresh: true,
    },
    ...(
      [
        ['Accept', 'application/json'],
        ['Accept-Encoding', 'gzip, deflate'],
        ['Accept-Language', 'en-US,en;q=0.9'],
        ['Content-Type', 'application/json'],
        ['Sec-WebSocket-Protocol', 'synthetic-responses-v1'],
        ['traceparent', '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'],
        ['tracestate', 'example=synthetic-trace'],
        ['baggage', 'region=synthetic-region'],
        ['X-Correlation-ID', 'synthetic-job-id'],
        ['b3', '0123456789abcdef0123456789abcdef-0123456789abcdef-1'],
        ['X-B3-TraceId', '0123456789abcdef0123456789abcdef'],
        ['x-b3-spanid', '0123456789abcdef'],
        ['X-B3-ParentSpanId', 'fedcba9876543210'],
        ['X-B3-Sampled', '1'],
        ['X-B3-Flags', '1'],
        ['sentry-trace', '0123456789abcdef0123456789abcdef-0123456789abcdef-1'],
        ['X-Amzn-Trace-Id', 'Root=1-01234567-0123456789abcdef01234567'],
        ['X-Cloud-Trace-Context', '0123456789abcdef0123456789abcdef/123456789;o=1'],
        ['X-Datadog-Trace-Id', '123456789'],
        ['X-Datadog-Parent-Id', '987654321'],
        ['X-Datadog-Sampling-Priority', '1'],
        ['X-Datadog-Origin', 'synthetics'],
        ['X-Datadog-Tags', '_dd.p.dm=-0'],
        ['Sec-WebSocket-Protocol', 'responses'],
      ] as const
    ).flatMap(([header, value]) => [
      {
        name: `socket ${header}`,
        headers: { [header]: value },
        defaultHeaders: {},
        authorization: undefined,
        needsRefresh: true,
      },
      {
        name: `client default ${header}`,
        headers: {},
        defaultHeaders: { [header]: value },
        authorization: undefined,
        needsRefresh: true,
      },
    ]),
    {
      name: 'socket safe auth metadata',
      headers: { 'X-Auth-Metadata': 'synthetic-route' },
      defaultHeaders: {},
      authorization: undefined,
      needsRefresh: true,
    },
    {
      name: 'undefined override',
      headers: { Authorization: undefined },
      defaultHeaders: {},
      authorization: undefined,
      needsRefresh: true,
    },
    {
      name: 'caller managed',
      headers: { authorization: 'Bearer caller-managed' },
      defaultHeaders: {},
      authorization: 'Bearer caller-managed',
      needsRefresh: false,
    },
    {
      name: 'client default Authorization removal',
      headers: {},
      defaultHeaders: { Authorization: null },
      authorization: undefined,
      needsRefresh: false,
    },
    {
      name: 'client default empty authorization',
      headers: {},
      defaultHeaders: { authorization: '' },
      authorization: '',
      needsRefresh: false,
    },
    {
      name: 'client default removal with undefined socket override',
      headers: { Authorization: undefined },
      defaultHeaders: { authorization: null },
      authorization: undefined,
      needsRefresh: false,
    },
    {
      name: 'socket credential over client default removal',
      headers: { authorization: 'Bearer socket' },
      defaultHeaders: { Authorization: null },
      authorization: 'Bearer socket',
      needsRefresh: false,
    },
  ])(
    'refreshes the provider only when needed for $name',
    async ({ headers, defaultHeaders, authorization, needsRefresh }) => {
      const server = new WebSocketServer({
        port: 0,
        host: '127.0.0.1',
        // A server may decline an offered subprotocol. Raw headers are not ws's own protocols argument.
        handleProtocols: () => false,
      });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      const upgrades: (string | undefined)[] = [];
      const messages: string[][] = [];
      server.on('connection', (peer, request) => {
        upgrades.push(request.headers.authorization);
        const received: string[] = [];
        messages.push(received);
        peer.on('message', (data) => received.push(String(data)));
      });
      let key = 'synthetic-A';
      const apiKey = vi.fn(async () => key);
      const client = new OpenAI({ apiKey, defaultHeaders, baseURL: `http://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      if (!needsRefresh) {
        apiKey.mockRejectedValue(new Error('Provider must not be called for a removed or overridden key'));
      }
      const initial = once(server, 'connection');
      // SAFETY: These tests exercise only shared stable/beta wire events and lifecycle methods.
      const connection = new Responses(client, {
        // SAFETY: Untyped callers can supply undefined, which the WS options merge explicitly ignores.
        headers: headers as Record<string, string>,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      const session = new ResponsesWebSocketSession(connection, {
        maxLanes: 4,
        maxBufferedEvents: 8,
        maxBufferedBytes: 4096,
      });
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        const sent = once(peer, 'message');
        session.lane('uncertain').create({ input: 'only-once' });
        await sent;
        key = 'synthetic-B';
        const reconnected = connection.emitted('reconnected');
        peer.close(1012);
        await reconnected;
        const neighbor = session.lane('neighbor');
        const [secondPeer] = [...server.clients];
        if (!secondPeer) {
          throw new Error('Missing reconnected peer');
        }
        const barrier = once(secondPeer, 'message');
        neighbor.create({ input: 'after-reconnect' });
        await barrier;
        expect(upgrades).toEqual(
          needsRefresh ? ['Bearer synthetic-A', 'Bearer synthetic-B'] : [authorization, authorization],
        );
        expect(messages.map((items) => items.map((item) => JSON.parse(item).input))).toEqual([
          ['only-once'],
          ['after-reconnect'],
        ]);
        expect(apiKey).toHaveBeenCalledTimes(needsRefresh ? 2 : 1);
      } finally {
        session.close();
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );

  test.each(
    [
      {
        name: 'Basic auth',
        options: { auth: 'synthetic:secret' },
        header: 'authorization',
        value: 'Basic c3ludGhldGljOnNlY3JldA==',
      },
      {
        name: 'X-API-Key',
        options: { headers: { 'X-API-Key': 'synthetic-custom-key' } },
        header: 'x-api-key',
        value: 'synthetic-custom-key',
      },
      {
        name: 'Cookie',
        options: { headers: { Cookie: 'session=synthetic' } },
        header: 'cookie',
        value: 'session=synthetic',
      },
      {
        name: 'Proxy-Authorization',
        options: { headers: { 'Proxy-Authorization': 'Basic synthetic' } },
        header: 'proxy-authorization',
        value: 'Basic synthetic',
      },
      {
        name: 'X-Custom',
        options: { headers: { 'X-Custom': 'synthetic-custom-key' } },
        header: 'x-custom',
        value: 'synthetic-custom-key',
      },
      {
        name: 'X-Auth-Token',
        options: { headers: { 'X-Auth-Token': 'synthetic-custom-key' } },
        header: 'x-auth-token',
        value: 'synthetic-custom-key',
      },
      {
        name: 'X-Tenant-Token',
        options: { headers: { 'X-Tenant-Token': 'synthetic-custom-key' } },
        header: 'x-tenant-token',
        value: 'synthetic-custom-key',
      },
    ].flatMap((variant) => [false, true].map((resolved) => ({ ...variant, resolved }))),
  )(
    'retains caller $name throughout reconnect with previously resolved provider $resolved',
    async ({ options, header, value, resolved }) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      const apiKey = vi.fn<() => Promise<string>>(async () => {
        throw new Error('This provider must not be used');
      });
      const requests: Record<string, string | string[] | undefined>[] = [];
      server.on('connection', (_peer, request) => {
        requests.push(request.headers);
      });
      const client = new OpenAI({ apiKey, baseURL: `http://127.0.0.1:${address.port}/v1` });
      if (resolved) {
        apiKey.mockResolvedValueOnce('synthetic-cached');
        await client._callApiKey();
      }
      const incoming = once(server, 'connection');
      // SAFETY: Stable and beta share these lifecycle events.
      const connection = new Responses(client, {
        ...options,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await incoming;
        await once(connection.socket.platformSocket, 'open');
        const reconnected = connection.emitted('reconnected');
        peer.close(1012);
        await reconnected;
        expect(apiKey).toHaveBeenCalledTimes(resolved ? 1 : 0);
        expect(requests.map((request) => request[header])).toEqual([value, value]);
        if (header !== 'authorization') {
          expect(requests.map((request) => request['authorization'])).toEqual([undefined, undefined]);
        }
      } finally {
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );

  test.each([
    { change: 'remove Authorization', laterKey: 'succeeds' },
    { change: 'add custom credential', laterKey: 'succeeds' },
    { change: 'remove Authorization', laterKey: 'rejects' },
    { change: 'add custom credential', laterKey: 'rejects' },
  ])(
    'keeps the handshake snapshot when client defaults $change during refresh and a later provider $laterKey',
    async ({ change, laterKey }) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      let refresh!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Gate the real callable provider during the handshake.
      const refreshing = new Promise<void>((resolve) => {
        refresh = resolve;
      });
      let release!: (key: string) => void;
      // oxlint-disable-next-line promise/avoid-new -- Mutate defaults while this credential operation is pending.
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const apiKey = vi
        .fn()
        .mockResolvedValueOnce('synthetic-A')
        .mockImplementation(() => {
          refresh();
          return pending;
        });
      const defaultHeaders = { 'X-Trace-ID': 'trace-before' };
      const requests: Record<string, string | string[] | undefined>[] = [];
      server.on('connection', (_peer, request) => {
        requests.push(request.headers);
      });
      const client = new OpenAI({ apiKey, defaultHeaders, baseURL: `http://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      const initial = once(server, 'connection');
      const betaHeader = ['responses=v1', 'route=original'];
      const socketHook = vi.fn();
      // SAFETY: Both constructors implement the same transport hook and lifecycle for this regression.
      class DelegatingResponses extends (Responses as typeof StableResponsesWS) {
        protected override _createSocket(url: URL, authHeaders: Record<string, string>) {
          socketHook();
          return super._createSocket(url, {
            ...authHeaders,
            Authorization: `${authHeaders['Authorization']}+transport`,
          });
        }
      }
      const connection = new DelegatingResponses(client, {
        // @ts-expect-error Node ws accepts HTTP header arrays at runtime; ClientOptions only types strings.
        headers: { 'OpenAI-Beta': betaHeader },
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      });
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        const reconnected = connection.emitted('reconnected');
        peer.close(1012);
        await refreshing;
        if (change === 'remove Authorization') {
          Object.assign(defaultHeaders, { Authorization: null });
        } else {
          Object.assign(defaultHeaders, { 'X-API-Key': 'late-custom-key' });
        }
        defaultHeaders['X-Trace-ID'] = 'trace-after';
        betaHeader.splice(0, betaHeader.length, 'responses=v2', 'route=mutated');
        if (laterKey === 'succeeds') {
          // The older active handshake keeps its own key without replacing this newer cached key.
          apiKey.mockResolvedValueOnce('synthetic-newer');
          await client._callApiKey();
        } else {
          apiKey.mockRejectedValueOnce(new Error('synthetic later provider failure'));
          await expect(client._callApiKey()).rejects.toThrow('synthetic later provider failure');
        }
        release('synthetic-B');
        await reconnected;
        expect(
          requests.map((request) => [
            request['authorization'],
            request['x-api-key'],
            request['x-trace-id'],
            request['openai-beta'],
          ]),
        ).toEqual([
          ['Bearer synthetic-A+transport', undefined, 'trace-before', 'responses=v1, route=original'],
          ['Bearer synthetic-B+transport', undefined, 'trace-before', 'responses=v1, route=original'],
        ]);
        expect(client.apiKey).toBe(laterKey === 'succeeds' ? 'synthetic-newer' : 'synthetic-B');
        expect(socketHook).toHaveBeenCalledTimes(2);
      } finally {
        release('synthetic-B');
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );

  test.each(['resolve', 'reject', 'close after resolution queued'])(
    'close while refresh is stalled completes before late %s',
    async (settlement) => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local server address');
      }
      let refresh!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Gate the provider at the actual async credential boundary.
      const refreshing = new Promise<void>((resolve) => {
        refresh = resolve;
      });
      let release!: (key: string) => void;
      let rejectRefresh!: (error: Error) => void;
      // oxlint-disable-next-line promise/avoid-new -- Keep the provider unresolved until the caller closes.
      const pending = new Promise<string>((resolve, reject) => {
        release = resolve;
        rejectRefresh = reject;
      });
      const apiKey = vi
        .fn()
        .mockResolvedValueOnce('synthetic-A')
        .mockImplementation(() => {
          refresh();
          return pending;
        });
      const upgrades: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => {
        upgrades.push(request.headers.authorization);
      });
      class LegacyOpenAI extends OpenAI {
        override _callApiKey(capture?: (apiKey: string | null) => void): Promise<boolean> {
          return super._callApiKey(capture);
        }
      }
      const client = new LegacyOpenAI({ apiKey, baseURL: `http://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      const initial = once(server, 'connection');
      // SAFETY: Stable and beta expose identical reconnect and close lifecycle methods.
      const connection = new Responses(client, {
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      const errors = vi.fn();
      // A persistent observer throwing once must never cause another close emission.
      const closes = vi.fn().mockImplementationOnce(() => {
        throw new Error('synthetic observer failure');
      });
      connection.on('error', errors);
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        const stream = connection.stream();
        await expect(stream.next()).resolves.toMatchObject({ value: { type: 'open' } });
        const closed = connection.emitted('close');
        connection.on('close', closes);
        peer.close(1012);
        await refreshing;
        await expect(stream.next()).resolves.toMatchObject({ value: { type: 'reconnecting' } });
        connection.send({ type: 'response.create', input: 'queued while refreshing' });
        // A newer request can resolve its key while the earlier refresh is still pending.
        apiKey.mockResolvedValueOnce('synthetic-newer');
        await client._callApiKey();
        if (settlement === 'close after resolution queued') {
          release('synthetic-B');
          queueMicrotask(() => connection.close({ code: 1000, reason: 'caller stopped' }));
        } else {
          connection.close({ code: 1000, reason: 'caller stopped' });
        }
        // Closure must not depend on the provider settling.
        await expect(
          Promise.race([closed.then(() => 'closed'), setImmediate().then(() => 'still pending')]),
        ).resolves.toBe('closed');
        await expect(stream.next()).resolves.toMatchObject({
          value: { type: 'close', code: 1000, reason: 'caller stopped', unsent: [expect.any(Object)] },
        });
        await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
        if (settlement === 'resolve') {
          release('synthetic-B');
        } else if (settlement === 'reject') {
          rejectRefresh(new Error('synthetic provider failure after close'));
        }
        await closed;
        await setImmediate();
        expect(upgrades).toEqual(['Bearer synthetic-A']);
        expect(errors).not.toHaveBeenCalled();
        expect(closes).toHaveBeenCalledTimes(1);
        const nextIncoming = once(server, 'connection');
        const successor = new Responses(client);
        try {
          await nextIncoming;
          await once(successor.socket.platformSocket, 'open');
          expect(upgrades).toEqual(['Bearer synthetic-A', 'Bearer synthetic-newer']);
        } finally {
          successor.close();
        }
      } finally {
        release('synthetic-B');
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
      }
    },
  );

  test('pins the URL and reconnect parameters before refreshing the key', async () => {
    const original = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const other = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await Promise.all([once(original, 'listening'), once(other, 'listening')]);
    const address = original.address();
    const otherAddress = other.address();
    if (!address || typeof address === 'string' || !otherAddress || typeof otherAddress === 'string') {
      throw new Error('Missing local server address');
    }
    const requests: { url: string | undefined; authorization: string | undefined }[] = [];
    original.on('connection', (_peer, request) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
    });
    const wrongOrigin = vi.fn();
    other.on('connection', wrongOrigin);
    let refresh!: () => void;
    // oxlint-disable-next-line promise/avoid-new -- Gate the provider while the URL and parameters are mutated.
    const refreshing = new Promise<void>((resolve) => {
      refresh = resolve;
    });
    let release!: (key: string) => void;
    // oxlint-disable-next-line promise/avoid-new -- Keep this handshake's credential pending at the mutation boundary.
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const apiKey = vi
      .fn()
      .mockResolvedValueOnce('synthetic-A')
      .mockImplementation(() => {
        refresh();
        return pending;
      });
    const parameters = { session: 'initial-session' };
    const client = new OpenAI({ apiKey, baseURL: `http://127.0.0.1:${address.port}/v1` });
    await client._callApiKey();
    const initial = once(original, 'connection');
    // SAFETY: These methods and lifecycle events are identical in the stable/beta Responses transports.
    const connection = new Responses(client, {
      reconnect: {
        maxRetries: 1,
        initialDelay: 0,
        maxDelay: 0,
        onReconnecting() {
          return { parameters };
        },
      },
    }) as StableResponsesWS;
    connection.on('error', () => {});
    try {
      const [peer] = await initial;
      await once(connection.socket.platformSocket, 'open');
      const reconnected = connection.emitted('reconnected');
      peer.close(1012);
      await refreshing;
      client.baseURL = `http://127.0.0.1:${otherAddress.port}/v1`;
      parameters.session = 'mutated-session';
      release('synthetic-B');
      await reconnected;
      expect(wrongOrigin).not.toHaveBeenCalled();
      expect(requests).toEqual([
        { url: '/v1/responses', authorization: 'Bearer synthetic-A' },
        { url: '/v1/responses?session=initial-session', authorization: 'Bearer synthetic-B' },
      ]);
      expect(connection.url.href).toBe(`ws://127.0.0.1:${address.port}/v1/responses?session=initial-session`);
    } finally {
      release('synthetic-B');
      connection.close();
      await Promise.all(
        [original, other].map((server) => {
          for (const peer of server.clients) {
            peer.terminate();
          }
          const closed = once(server, 'close');
          server.close();
          return closed;
        }),
      );
    }
  });

  test.each(['Buffer', 'ca Uint8Array', 'cert Uint8Array', 'key.pem Uint8Array', 'key Uint8Array'])(
    'pins mutable CA and client identity during a TLS reconnect refresh: %s',
    async (material) => {
      const lab = createX509TestLab();
      const https = createServer({
        cert: lab.server.certificate,
        key: lab.server.privateKey,
        ca: lab.certificateAuthority,
        requestCert: true,
        rejectUnauthorized: true,
      });
      const server = new WebSocketServer({ server: https });
      const listening = once(https, 'listening');
      https.listen(0, '127.0.0.1');
      await listening;
      const address = https.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing local HTTPS address');
      }
      const requests: (string | undefined)[] = [];
      server.on('connection', (_peer, request) => requests.push(request.headers.authorization));
      let refresh!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- Mutate original TLS buffers during the actual credential wait.
      const refreshing = new Promise<void>((resolve) => {
        refresh = resolve;
      });
      let release!: (key: string) => void;
      // oxlint-disable-next-line promise/avoid-new -- Delay only the reconnect credential, not the initial TLS handshake.
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const apiKey = vi
        .fn()
        .mockResolvedValueOnce('synthetic-A')
        .mockImplementation(() => {
          refresh();
          return pending;
        });
      const tlsBytes = (bytes: Buffer, name: string): Buffer | Uint8Array => {
        if (material !== name) {
          return Buffer.from(bytes);
        }
        const backing = new Uint8Array(bytes.byteLength + 8);
        backing.set(bytes, 4);
        return backing.subarray(4, 4 + bytes.byteLength);
      };
      const caBuffer = tlsBytes(lab.certificateAuthority, 'ca Uint8Array');
      const certBuffer = tlsBytes(lab.firstClient.certificate, 'cert Uint8Array');
      const ca = [caBuffer];
      const cert = [certBuffer];
      const pem = tlsBytes(lab.firstClient.privateKey, material.startsWith('key') ? material : '');
      const keyWrapper = { pem, passphrase: '' };
      const key = material === 'key Uint8Array' ? [pem] : [keyWrapper];
      // SAFETY: Node TLS accepts ArrayBufferViews at runtime. @types/node narrows these fields to Buffer.
      const tlsOptions = { ca, cert, key } as Pick<
        NonNullable<ConstructorParameters<typeof StableResponsesWS>[1]>,
        'ca' | 'cert' | 'key'
      >;
      const client = new OpenAI({ apiKey, baseURL: `https://127.0.0.1:${address.port}/v1` });
      await client._callApiKey();
      const initial = once(server, 'connection');
      // SAFETY: Stable and beta expose identical lifecycle events.
      const connection = new Responses(client, {
        ...tlsOptions,
        reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting() {} },
      }) as StableResponsesWS;
      connection.on('error', () => {});
      try {
        const [peer] = await initial;
        await once(connection.socket.platformSocket, 'open');
        const reconnected = connection.emitted('reconnected');
        peer.close(1012);
        await refreshing;
        caBuffer.fill(0);
        certBuffer.fill(0);
        pem.fill(0);
        keyWrapper.passphrase = 'invalid';
        ca.push(Buffer.from('invalid CA'));
        cert.push(Buffer.from('invalid cert'));
        release('synthetic-B');
        await reconnected;
        expect(requests).toEqual(['Bearer synthetic-A', 'Bearer synthetic-B']);
      } finally {
        release('synthetic-B');
        connection.close();
        for (const peer of server.clients) {
          peer.terminate();
        }
        const closed = once(server, 'close');
        server.close();
        await closed;
        const stopped = once(https, 'close');
        https.close();
        await stopped;
      }
    },
  );
});
