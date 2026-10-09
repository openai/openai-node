// This fixture is copied into the packed consumer to use actual public Node entrypoints.
/* oxlint-disable eslint/no-restricted-imports -- Package entrypoints are the contract under test in the isolated consumer. */
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');
const { WebSocketServer } = require('ws');
const CommonJSClient = require('openai');
const commonJSStable = require('openai/resources/responses/ws');
const commonJSBeta = require('openai/resources/beta/responses/ws');

const commonJSResponses = {
  responses: commonJSStable,
  'beta/responses': commonJSBeta,
};

for (const surface of ['responses', 'beta/responses']) {
  for (const clientFormat of ['require', 'import']) {
    for (const socketFormat of ['require', 'import']) {
      test(
        `${surface}: ${clientFormat} client + ${socketFormat} WS ignores canceled refresh`,
        { timeout: 5000 },
        async () => {
          const esmClient = await import('openai');
          const Client = clientFormat === 'require' ? CommonJSClient : esmClient.default;
          const moduleName = `openai/resources/${surface}/ws`;
          const { ResponsesWS } =
            socketFormat === 'require' ? commonJSResponses[surface] : await import(moduleName);
          const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
          await once(server, 'listening');
          const address = server.address();
          let release;
          let entered;
          // oxlint-disable-next-line promise/avoid-new -- Hold the provider until the reconnect is canceled.
          const providerResult = new Promise((resolve) => {
            release = resolve;
          });
          // oxlint-disable-next-line promise/avoid-new -- Synchronize at the real credential hook boundary.
          const providerEntered = new Promise((resolve) => {
            entered = resolve;
          });
          let calls = 0;
          const upgrades = [];
          const errors = [];
          server.on('connection', (_peer, request) => upgrades.push(request.headers.authorization));
          const client = new Client({
            baseURL: `http://127.0.0.1:${address.port}/v1`,
            apiKey: () => {
              calls += 1;
              if (calls === 1) {
                return 'synthetic-initial';
              }
              entered();
              return providerResult;
            },
          });
          await client._callApiKey();
          const initial = once(server, 'connection');
          const connection = new ResponsesWS(client, {
            reconnect: { maxRetries: 1, initialDelay: 0, maxDelay: 0, onReconnecting: () => ({}) },
          });
          connection.on('error', (error) => errors.push(error));
          try {
            const [peer] = await initial;
            await once(connection.socket.platformSocket, 'open');
            const closed = connection.emitted('close');
            peer.close(1012);
            await providerEntered;
            connection.close({ code: 1000, reason: 'caller canceled refresh' });
            await closed;
            release('synthetic-canceled');
            await setImmediate();
            const incoming = once(server, 'connection');
            const successor = new ResponsesWS(client);
            try {
              await incoming;
              await once(successor.socket.platformSocket, 'open');
              assert.equal(calls, 2, 'synchronous WS should use cached credentials');
              assert.deepEqual(upgrades, ['Bearer synthetic-initial', 'Bearer synthetic-initial']);
              assert.deepEqual(errors, []);
            } finally {
              successor.close();
            }
          } finally {
            release('synthetic-canceled');
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
    }
  }
}
