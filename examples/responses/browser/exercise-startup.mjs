import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const originalCreate = http.createServer;
const originalLaunch = chromium.launch;
const originalModel = process.env['OPENAI_MODEL'];
process.env['OPENAI_MODEL'] = 'local-fixture';
try {
  for (const failure of ['launch', 'context']) {
    const servers = [];
    let closed = 0;
    http.createServer = (...args) => {
      const server = originalCreate(...args);
      servers.push(server);
      return server;
    };
    syncBuiltinESMExports();
    chromium.launch = async () => {
      if (failure === 'launch') {
        throw new Error('Expected launch failure');
      }
      return {
        async newContext() {
          throw new Error('Expected context failure');
        },
        async close() {
          closed += 1;
          throw new Error('Expected browser cleanup failure');
        },
      };
    };
    try {
      // Each import starts and cleans up its own fixture server without calling an API.
      // oxlint-disable-next-line no-await-in-loop
      await assert.rejects(import(`./run.mjs?startup=${failure}`), /Expected/u);
      assert.equal(servers.length, 1);
      assert.equal(servers[0].listening, false, `${failure} failure must close the fixture server`);
      assert.equal(closed, failure === 'context' ? 1 : 0);
    } finally {
      // Keep the regression safe when run against the unfixed example.
      // oxlint-disable-next-line no-await-in-loop
      await Promise.all(
        servers.filter((server) => server.listening).map((server) => promisify(server.close.bind(server))()),
      );
    }
  }
} finally {
  http.createServer = originalCreate;
  syncBuiltinESMExports();
  chromium.launch = originalLaunch;
  if (originalModel === undefined) {
    delete process.env['OPENAI_MODEL'];
  } else {
    process.env['OPENAI_MODEL'] = originalModel;
  }
}
console.log('PASS failed browser launch or cleanup closes the local fixture server; no API calls');
