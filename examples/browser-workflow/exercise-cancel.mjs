import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(path.join(tmpdir(), 'workflow-cancel-'));
try {
  for (const stage of ['request', 'approval']) {
    let requests = 0;
    const server = createServer(async (request, response) => {
      assert.equal(request.url, '/v1/responses');
      let content = '';
      for await (const chunk of request) {
        content += chunk;
      }
      requests += 1;
      if (stage === 'request') {
        // oxlint-disable-next-line no-use-before-define -- Only the child launched after listen can send this request.
        child.kill('SIGINT');
        // Hold this local request while the run is stopped.
        return;
      }
      const body = JSON.parse(content);
      let member = 'read_page';
      let args = { tab_id: null, filter: 'all' };
      if (requests > 1) {
        const observed = JSON.parse(body.input.at(-1).output[0].text);
        args = { tab_id: null, target: observed.result.elements[0].ref };
        member = 'click';
      }
      response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      response.end(
        JSON.stringify({
          id: `resp_${requests}`,
          object: 'response',
          created_at: 0,
          status: 'completed',
          model: '',
          output: [
            {
              type: 'function_call',
              id: `fc_${requests}`,
              call_id: `call_${requests}`,
              name: `browser_${member}`,
              arguments: JSON.stringify(args),
              status: 'completed',
            },
          ],
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    // oxlint-disable-next-line no-await-in-loop -- Start and stop each isolated CLI probe before the next.
    await once(server, 'listening');
    const receipt = path.join(directory, `${stage}.json`);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('OPENAI_')),
    );
    Object.assign(env, {
      OPENAI_API_KEY: 'synthetic-local-not-a-key',
      OPENAI_MODEL: 'synthetic-local',
      OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    });
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('run.mjs', import.meta.url)), '--receipt', receipt],
      {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let errors = '';
    let stopped = false;
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (stage === 'approval' && !stopped && output.includes('? [y/N] ')) {
        assert.match(output, /Requests/u);
        assert.match(output, /button/u);
        stopped = true;
        child.kill('SIGINT');
      }
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
    try {
      // Keep stdin open: a run must not need EOF to finish cancellation.
      // oxlint-disable-next-line no-await-in-loop -- Await one owned child lifecycle at a time.
      const [code, signal] = await once(child, 'exit');
      assert.equal(signal, null, `${stage} timed out: ${errors}`);
      assert.equal(code, 1, errors);
      assert.match(output, /\{"status":"stopped"\}\s*$/u);
      // oxlint-disable-next-line no-await-in-loop -- Inspect this CLI's saved record before closing the fixture.
      const text = await readFile(receipt, 'utf-8');
      const saved = JSON.parse(text);
      assert.equal(saved.status, 'stopped');
      assert.equal(saved.cleanup, true);
      assert.deepEqual(saved.stored, { bookings: {}, correspondence: {} });
      assert.ok(!text.includes('synthetic-local'));
      // oxlint-disable-next-line no-await-in-loop -- Check the private receipt's actual file permissions.
      const file = await stat(receipt);
      // oxlint-disable-next-line no-bitwise -- Check Unix owner-only permission bits.
      assert.equal(file.mode & 0o777, 0o600);
      console.log(
        `PASS SIGINT during CLI ${stage} records stopped, cleans up, preserves empty stores, and exits.`,
      );
    } finally {
      clearTimeout(timeout);
      child.kill();
      server.closeAllConnections();
      server.close();
      // oxlint-disable-next-line no-await-in-loop -- Dispose this owned local listener before the next probe.
      await once(server, 'close');
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
