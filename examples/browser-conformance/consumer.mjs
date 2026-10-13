// See README.md. Use an installed package, without network or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const catalogFile = fileURLToPath(new URL('vectors.json', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(catalogFile));
const { values } = parseArgs({
  options: {
    consumer: { type: 'string' },
    archive: { type: 'string' },
    source: { type: 'string' },
    'package-head': { type: 'string' },
    format: { type: 'string' },
  },
});
for (const name of ['consumer', 'archive', 'source', 'package-head', 'format']) {
  assert.ok(values[name], `Required --${name}`);
}
const consumer = fs.realpathSync(values.consumer);
const archive = fs.realpathSync(values.archive);
const checkout = fs.realpathSync(values.source);
const packageHead = values['package-head'];
const mode = values.format;
assert.ok(['cjs', 'esm'].includes(mode), 'Choose cjs or esm explicitly');
const installed = createRequire(path.join(consumer, 'package.json'));
const checks = [];
const pending = [];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (p) => digest(fs.readFileSync(p));
const git = (...args) => execFileSync('git', ['-C', checkout, ...args]);
const fixtureState = () => structuredClone(catalog.state);
function unexpectedComputerAction() {
  throw new Error('Unexpected computer action in conformance fixture');
}
function computerDriver(overrides) {
  return {
    click: unexpectedComputerAction,
    double_click: unexpectedComputerAction,
    drag: unexpectedComputerAction,
    keypress: unexpectedComputerAction,
    move: unexpectedComputerAction,
    scroll: unexpectedComputerAction,
    type: unexpectedComputerAction,
    wait: unexpectedComputerAction,
    screenshot: unexpectedComputerAction,
    ...overrides,
  };
}
const call = (member, args, id = member, raw = null) => ({
  id: `fc_${id}`,
  type: 'function_call',
  status: 'completed',
  call_id: id,
  name: `browser_${member}`,
  arguments: raw ?? JSON.stringify(args),
});
const body = (output) => {
  assert.equal(output.type, 'function_call_output');
  assert.equal(output.output[0].type, 'input_text');
  return JSON.parse(output.output[0].text);
};
async function check(id, run) {
  try {
    await run();
    checks.push({ id, pass: true });
  } catch (error) {
    checks.push({ id, pass: false, error: error.message });
  }
}
async function sdk(name) {
  const base = fs.realpathSync(installed.resolve(name));
  assert.ok(
    base.startsWith(consumer + path.sep) && base.includes('/node_modules/openai/'),
    'SDK must resolve inside the supplied installed consumer, never the source checkout',
  );
  const resolved = mode === 'cjs' ? base : base.replace(/\.js$/u, '.mjs');
  const pkg = path.dirname(fs.realpathSync(installed.resolve('openai')));
  const packed = execFileSync('tar', ['-xOf', archive, `package/${path.relative(pkg, resolved)}`]);
  assert.equal(sha(resolved), digest(packed), `${name} installed entrypoint differs from archive`);
  return mode === 'cjs' ? installed(name) : import(pathToFileURL(resolved));
}
function sse(response, interrupted, completedOutput = response.output) {
  const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }];
  for (const [output_index, item] of response.output.entries()) {
    events.push({
      type: 'response.output_item.added',
      output_index,
      item: item.type === 'function_call' ? { ...item, arguments: '' } : item,
    });
    if (item.type === 'function_call') {
      events.push({
        type: 'response.function_call_arguments.delta',
        output_index,
        item_id: item.id,
        delta: item.arguments,
      });
    }
    events.push({ type: 'response.output_item.done', output_index, item });
  }
  if (!interrupted) {
    events.push({ type: 'response.completed', response: { ...response, output: completedOutput } });
  }
  return `${events.map((event, i) => `data: ${JSON.stringify({ ...event, sequence_number: i })}\n\n`).join('')}data: [DONE]\n\n`;
}
async function main() {
  const { default: OpenAI } = await sdk('openai');
  const { BrowserToolset } = await sdk('openai/helpers/browser');
  const { ComputerToolset } = await sdk('openai/helpers/computer');
  const { ResponsesToolRunner, ResponsesToolRunnerError } = await sdk('openai/helpers/responses-tool-runner');
  const pkg = path.dirname(installed.resolve('openai'));
  const helpers = ['browser', 'computer', 'responses-tool-runner'];
  const hashes = {};
  for (const name of helpers) {
    const packed = path.join(pkg, 'src/helpers', `${name}.ts`);
    const current = path.join(checkout, 'src/helpers', `${name}.ts`);
    const file = `src/helpers/${name}.ts`;
    assert.equal(sha(packed), sha(current), `${name} packed source differs from current helper`);
    assert.equal(
      sha(packed),
      digest(git('show', `${packageHead}:${file}`)),
      `${name} source differs from package head`,
    );
    assert.equal(
      sha(packed),
      digest(execFileSync('tar', ['-xOf', archive, `package/${file}`])),
      `${name} source differs from archive`,
    );
    hashes[name] = sha(packed);
  }
  function tool(vector, override = {}) {
    const state = fixtureState();
    const events = [];
    const driver = {
      marker: 'receiver',
      state() {
        events.push('state');
        return state;
      },
    };
    if (vector.member !== 'list_tabs') {
      driver[vector.member] = function perform(args) {
        assert.equal(this.marker, 'receiver');
        events.push(['effect', structuredClone(args)]);
        state.tabs[0].title = 'After';
        return vector.member === 'screenshot' ? structuredClone(catalog.image) : `completed:${vector.member}`;
      };
    }
    const options = {
      members: [vector.member],
      confirm(ctx) {
        events.push('confirm');
        assert.equal(ctx.state.tabs[0].title, 'Before');
        return true;
      },
      urlPolicy(ctx, url) {
        events.push('url');
        assert.equal(url, vector.arguments.url);
        return true;
      },
      ...override,
    };
    return { browser: new BrowserToolset(driver, options), driver, options, events, state };
  }
  function observation(value) {
    const state = fixtureState();
    if (value !== null) {
      state.observation = structuredClone(value);
    }
    return state;
  }
  async function observed(first, last, phase, invalid) {
    const listing = phase === 'list';
    const member = phase === 'policy' ? 'navigate' : 'click';
    const vector = catalog.browser.find((item) => item.member === (listing ? 'list_tabs' : member));
    const t = tool(vector);
    let count = 0;
    t.driver.state = () => {
      count += 1;
      return count === 1 ? first : last;
    };
    if (phase === 'refusal') {
      t.options.confirm = () => false;
    }
    if (phase === 'error') {
      t.options.confirm = () => {
        throw new Error('SYNTHETIC_PRIVATE');
      };
    }
    const action = call(vector.member, vector.arguments);
    if (invalid) {
      await assert.rejects(t.browser.execute(action), /^Error: Browser state report failed\.$/u);
    } else {
      const output = body(await t.browser.execute(action));
      assert.equal(output.ok, !['error', 'refusal'].includes(phase));
      assert.deepEqual(output.state.observation, last.observation);
      if (listing) {
        assert.deepEqual(output.result.observation, first.observation);
      }
      assert.ok(!JSON.stringify(output).includes('SYNTHETIC_PRIVATE'));
    }
    const permitted = phase === 'final' && count === 2;
    assert.equal(t.events.filter(Array.isArray).length, Number(permitted));
    if (phase === 'policy') {
      assert.deepEqual(t.events, [], 'Invalid initial state must not reach policy, consent or driver');
    }
  }
  for (const bad of catalog.v1.invalid_observations) {
    for (const phase of ['initial', 'final', 'list', 'refusal', 'error']) {
      const malformed = fixtureState();
      malformed.observation = bad.value;
      const valid = observation(catalog.v1.empty);
      pending.push(
        check(`v1:invalid:${bad.id}:${phase}`, () =>
          observed(phase === 'initial' ? malformed : valid, malformed, phase, true),
        ),
      );
    }
  }
  for (const transition of catalog.v1.transitions) {
    for (const phase of ['final', 'list', 'refusal', 'error']) {
      pending.push(
        check(`v1:transition:${transition.id}:${phase}`, () =>
          observed(observation(transition.before), observation(transition.after), phase, !transition.valid),
        ),
      );
    }
  }
  for (const url of catalog.v1.urls) {
    pending.push(
      check(`v1:url:${url.id}`, async () => {
        const t = tool(catalog.browser.find((item) => item.member === 'list_tabs'));
        const value = observation(catalog.v1.empty);
        value.tabs[0].url = url.value;
        t.driver.state = () => value;
        if (url.origin === null) {
          await assert.rejects(t.browser.execute(call('list_tabs', {})), /Browser state report failed/u);
        } else {
          const result = body(await t.browser.execute(call('list_tabs', {})));
          assert.equal(result.state.tabs[0].url, url.origin);
          assert.equal(result.result.tabs[0].url, url.origin);
        }
      }),
    );
  }
  pending.push(
    ...catalog.v1.authority_reads.map((url) =>
      check(`v1:authority:${url.id}:${url.phase}`, () => {
        const bad = observation(catalog.v1.empty);
        bad.tabs[0].url = url.value;
        const first = url.phase === 'policy' ? bad : observation(catalog.v1.empty);
        return observed(first, bad, url.phase, true);
      }),
    ),
  );
  for (const text of catalog.v1.text) {
    pending.push(
      check(`v1:text:${text.id}`, async () => {
        const t = tool(catalog.browser.find((item) => item.member === 'list_tabs'));
        const value = observation(catalog.v1.empty);
        value.tabs[0][text.field] = text.value;
        t.driver.state = () => value;
        if (text.valid) {
          const result = body(await t.browser.execute(call('list_tabs', {})));
          assert.equal(result.state.tabs[0][text.field], text.value);
        } else {
          await assert.rejects(t.browser.execute(call('list_tabs', {})), /Browser state report failed/u);
        }
      }),
    );
  }
  for (const { count, valid } of catalog.v1.tab_counts) {
    pending.push(
      check(`v1:tabs:${count}`, async () => {
        const t = tool(catalog.browser.find((item) => item.member === 'list_tabs'));
        const value = observation(catalog.v1.empty);
        value.tabs = Array.from({ length: count }, (_, i) => ({
          ...value.tabs[0],
          id: String(i),
          active: i === 0,
        }));
        t.driver.state = () => value;
        if (valid) {
          assert.equal(body(await t.browser.execute(call('list_tabs', {}))).state.tabs.length, count);
        } else {
          await assert.rejects(t.browser.execute(call('list_tabs', {})), /Browser state report failed/u);
        }
      }),
    );
  }
  pending.push(
    check('v1:policy-projection-and-new-call-reset', async () => {
      const navigate = catalog.browser.find((item) => item.member === 'navigate');
      const t = tool(navigate);
      const value = observation(catalog.v1.events);
      value.tabs[0].url = 'https://user:pw@EXAMPLE.com:443/private?q=SYNTHETIC_PRIVATE';
      value.tabs[0].private = () => 'uncopyable';
      value.observation.private = () => 'uncopyable';
      value.observation.changes[0].private = () => 'uncopyable';
      t.driver.state = () => value;
      t.options.urlPolicy = (ctx, url) => {
        assert.equal(url, navigate.arguments.url);
        assert.equal(ctx.arguments.url, navigate.arguments.url);
        assert.equal(ctx.state.tabs[0].url, 'https://example.com');
        assert.deepEqual(ctx.state.observation, catalog.v1.events);
        ctx.state.observation.changes.length = 0;
        ctx.state.tabs[0].title = 'Callback-only';
        return true;
      };
      const output = body(await t.browser.execute(call('navigate', navigate.arguments)));
      assert.ok(output.ok);
      assert.deepEqual(output.state.observation, catalog.v1.events);
      assert.equal(output.state.tabs[0].url, 'https://example.com');
      assert.equal(value.tabs[0].title, 'Before');
      t.driver.state = () => observation(catalog.v1.empty);
      t.options.urlPolicy = () => true;
      assert.ok(body(await t.browser.execute(call('navigate', navigate.arguments))).ok);
    }),
  );
  for (const vector of catalog.browser) {
    pending.push(
      check(`member:${vector.member}`, async () => {
        const t = tool(vector);
        assert.deepEqual(
          t.browser.tools().map((x) => x.name),
          [`browser_${vector.member}`],
        );
        const output = await t.browser.execute(call(vector.member, vector.arguments));
        const result = body(output);
        assert.equal(result.ok, true);
        assert.equal(output.call_id, vector.member);
        if (vector.member === 'list_tabs') {
          assert.deepEqual(result.state, catalog.reported_state);
          assert.deepEqual(t.events, ['state', 'state']);
        } else {
          assert.deepEqual(t.events, [
            'state',
            ...(vector.url ? ['url'] : []),
            ...(vector.change ? ['confirm'] : []),
            ['effect', vector.arguments],
            'state',
          ]);
          assert.equal(result.state.tabs[0].title, 'After');
          if (vector.member === 'screenshot') {
            assert.deepEqual(output.output[1], catalog.image);
          } else {
            assert.equal(result.result, `completed:${vector.member}`);
          }
        }
      }),
    );
  }
  const click = catalog.browser.find((v) => v.member === 'click');
  for (const bad of catalog.invalid_states) {
    for (const phase of ['initial', 'final', 'list_tabs']) {
      pending.push(
        check(`state:${bad.id}:${phase}`, async () => {
          const vector =
            phase === 'list_tabs' ? catalog.browser.find((v) => v.member === 'list_tabs') : click;
          const t = tool(vector);
          let n = 0;
          t.driver.state = () => {
            n += 1;
            return n === (phase === 'final' ? 2 : 1) ? structuredClone(bad.value) : fixtureState();
          };
          await assert.rejects(
            t.browser.execute(call(vector.member, vector.arguments)),
            /Browser state report failed/u,
          );
          assert.equal(t.events.filter((x) => Array.isArray(x)).length, phase === 'final' ? 1 : 0);
        }),
      );
    }
  }
  for (const bad of catalog.invalid_arguments) {
    pending.push(
      check(`arguments:${bad.id}`, async () => {
        const t = tool(catalog.browser.find((v) => v.member === bad.member));
        assert.equal(body(await t.browser.execute(call(bad.member, null, bad.id, bad.raw))).ok, false);
        assert.deepEqual(t.events, ['state', 'state']);
      }),
    );
  }
  for (const [i, value] of catalog.refuse_values.entries()) {
    pending.push(
      check(`strict-confirm:${i}`, async () => {
        const t = tool(click, { confirm: () => structuredClone(value) });
        assert.equal(body(await t.browser.execute(call('click', click.arguments))).ok, false);
        assert.deepEqual(t.events, ['state', 'state']);
      }),
    );
  }
  for (const entry of catalog.entry_policies) {
    for (const phase of ['missing', 'removed']) {
      pending.push(
        check(`entry-policy:${entry.id}:${phase}`, async () => {
          const vector = catalog.browser.find((v) => v.member === entry.member);
          const events = [];
          const driver = {
            get state() {
              events.push('state-getter');
              return () => {
                events.push('state');
                return fixtureState();
              };
            },
            [entry.member]() {
              events.push('effect');
              return 'done';
            },
          };
          const options = {
            members: [entry.member],
            confirm() {
              events.push('confirm');
              return true;
            },
            urlPolicy() {
              events.push('url');
              return true;
            },
          };
          const name = entry.id === 'url_policy' ? 'urlPolicy' : 'confirm';
          if (phase === 'missing') {
            options[name] = undefined;
            assert.throws(() => new BrowserToolset(driver, options));
            assert.deepEqual(events, []);
          } else {
            const browser = new BrowserToolset(driver, options);
            assert.deepEqual(events, []);
            options[name] = undefined;
            assert.equal(body(await browser.execute(call(entry.member, vector.arguments))).ok, false);
            assert.deepEqual(events, ['state-getter', 'state', 'state']);
          }
        }),
      );
    }
  }
  pending.push(
    check('excluded-getter-and-disabled-dispatch', async () => {
      let calls = 0;
      const driver = {
        state: fixtureState,
        get_page_text() {
          calls += 1;
          return 'text';
        },
        get click() {
          throw new Error('excluded getter read');
        },
      };
      const b = new BrowserToolset(driver, { members: ['get_page_text'] });
      await assert.rejects(b.execute(call('click', click.arguments)));
      assert.equal(calls, 0);
      assert.equal(body(await b.execute(call('get_page_text', { tab_id: null }))).result, 'text');
      assert.equal(calls, 1);
    }),
    check('async-handler-policy-state-snapshots', async () => {
      const vector = catalog.browser.find((v) => v.member === 'navigate');
      const events = [];
      const options = {
        members: ['navigate'],
        confirm() {
          events.push('confirm');
          return true;
        },
        async urlPolicy() {
          await Promise.resolve();
          events.push('url');
          options.confirm = () => false;
          return true;
        },
      };
      const driver = {
        marker: 'original',
        async state() {
          await Promise.resolve();
          events.push('original-state');
          driver.state = async () => ({ tabs: [] });
          driver.navigate = () => {
            events.push('replaced-effect');
            return 'replaced';
          };
          options.urlPolicy = () => false;
          return fixtureState();
        },
        navigate(args) {
          assert.equal(this.marker, 'original');
          events.push(args.url);
          return 'moved';
        },
      };
      const b = new BrowserToolset(driver, options);
      const first = body(await b.execute(call('navigate', vector.arguments)));
      assert.equal(first.ok, true);
      assert.deepEqual(first.state, catalog.reported_state);
      assert.deepEqual(events, ['original-state', 'url', 'confirm', vector.arguments.url, 'original-state']);
      // Isolate the next call's URL denial from the confirmation denial.
      options.confirm = () => true;
      assert.equal(body(await b.execute(call('navigate', vector.arguments))).ok, false);
      assert.equal(events.filter((x) => x === vector.arguments.url).length, 1);
      assert.ok(!events.includes('replaced-effect'));
    }),
    check('policy-captured-before-state-getter', async () => {
      const events = [];
      const options = {
        members: ['click'],
        confirm() {
          events.push('deny');
          return false;
        },
      };
      const driver = {
        get state() {
          events.push('state-getter');
          options.confirm = () => {
            events.push('allow');
            return true;
          };
          return () => {
            events.push('state');
            return fixtureState();
          };
        },
        click() {
          events.push('effect');
          return 'done';
        },
      };
      const browser = new BrowserToolset(driver, options);
      assert.equal(body(await browser.execute(call('click', click.arguments))).ok, false);
      assert.deepEqual(events, ['state-getter', 'state', 'deny', 'state']);
      assert.equal(body(await browser.execute(call('click', click.arguments))).ok, true);
      assert.deepEqual(events, [
        'state-getter',
        'state',
        'deny',
        'state',
        'state-getter',
        'state',
        'allow',
        'effect',
        'state',
      ]);
    }),
    check('cancellation-before-effect', async () => {
      const control = new AbortController();
      const t = tool(click, {
        confirm: async () => {
          await Promise.resolve();
          control.abort();
          return true;
        },
      });
      await assert.rejects(t.browser.execute(call('click', click.arguments), { signal: control.signal }));
      assert.equal(t.events.filter((x) => Array.isArray(x)).length, 0);
    }),
    check('generic-callback-error-not-shared', async () => {
      const t = tool(click, {
        confirm() {
          throw new Error('SYNTHETIC private callback detail');
        },
      });
      const output = await t.browser.execute(call('click', click.arguments));
      assert.equal(body(output).ok, false);
      assert.ok(!JSON.stringify(output).includes('SYNTHETIC'));
      assert.deepEqual(t.events, ['state', 'state']);
    }),
  );
  async function mixed(stream, eager, interrupt = false) {
    const bodies = [];
    const events = [];
    const effects = [];
    const native = new ComputerToolset(
      computerDriver({
        type(action) {
          effects.push(`native:${action.text}`);
        },
        screenshot() {
          effects.push('native-shot');
          return { type: 'computer_screenshot', image_url: catalog.image.image_url };
        },
      }),
    );
    const browser = new BrowserToolset(
      {
        state: fixtureState,
        read_page() {
          effects.push('read');
          return 'r1: invoice';
        },
        screenshot() {
          effects.push('image');
          return catalog.image;
        },
      },
      { members: ['read_page', 'screenshot'] },
    );
    const read = call('read_page', { tab_id: null, filter: 'all' }, 'read');
    const record = { ...call('record', { text: 'filed' }, 'record'), name: 'record' };
    const turns = [
      [catalog.reasoning, read, record, catalog.native, call('screenshot', { tab_id: null }, 'picture')],
      [catalog.final],
    ];
    const client = new OpenAI({
      apiKey: 'synthetic-unused',
      baseURL: 'http://fixture.invalid/v1',
      maxRetries: 0,
      fetch: async (url, init) => {
        const req = JSON.parse(init.body);
        const output = turns[bodies.length];
        assert.ok(output, 'unexpected request');
        bodies.push(req);
        const response = {
          id: `resp_${bodies.length}`,
          object: 'response',
          created_at: 0,
          model: '',
          status: 'completed',
          output,
        };
        return stream
          ? new Response(sse(response, interrupt), { headers: { 'content-type': 'text/event-stream' } })
          : Response.json(response);
      },
    });
    const runner = new ResponsesToolRunner({
      browser,
      computer: native,
      functions: [
        {
          tool: catalog.record_tool,
          execute(args) {
            effects.push(`function:${args.text}`);
            return args.text;
          },
        },
      ],
    });
    let failed;
    try {
      const result = await runner.run(
        client,
        { model: '', input: 'Process the local fixture', store: false },
        {
          stream,
          eager,
          onEvent(event) {
            events.push(event.type);
          },
          maxSteps: 3,
        },
      );
      assert.equal(result.output_text, 'Fixture complete');
    } catch (error) {
      failed = error;
    }
    if (interrupt) {
      assert.ok(failed, 'interruption must stop');
      assert.equal(bodies.length, 1);
      assert.deepEqual(
        effects,
        eager ? ['read', 'function:filed', 'native:Receipt', 'native-shot', 'image'] : [],
      );
      assert.deepEqual(failed.attemptedCallIds, eager ? ['read', 'record', 'native_one', 'picture'] : []);
      return;
    }
    if (failed) {
      throw failed;
    }
    assert.deepEqual(effects, ['read', 'function:filed', 'native:Receipt', 'native-shot', 'image']);
    assert.equal(bodies.length, 2);
    const history = bodies[1].input;
    assert.deepEqual(
      history.filter((x) => x.type?.endsWith('_call_output')).map((x) => x.call_id),
      ['read', 'record', 'native_one', 'picture'],
    );
    assert.equal(history.find((x) => x.type === 'reasoning').encrypted_content, 'fixture-reasoning');
    assert.equal(history.find((x) => x.type === 'computer_call_output').output.type, 'computer_screenshot');
    assert.deepEqual(
      history.find((x) => x.call_id === 'picture' && x.type === 'function_call_output').output[1],
      catalog.image,
    );
    assert.equal(events.includes('response.output_item.done'), stream);
    assert.ok(!JSON.stringify(history).includes('parsed_arguments'));
  }
  for (const [stream, eager] of [
    [false, false],
    [true, false],
    [true, true],
  ]) {
    pending.push(check(`mixed:${stream}:${eager}`, () => mixed(stream, eager)));
  }
  for (const eager of [false, true]) {
    pending.push(check(`interruption:${eager}`, () => mixed(true, eager, true)));
  }
  async function iteration(vector) {
    const bodies = [];
    const effects = [];
    const browser = new BrowserToolset(
      {
        state: fixtureState,
        read_page(args) {
          assert.deepEqual(args, { tab_id: null, filter: 'all' });
          effects.push('read');
          return 'r1: invoice';
        },
      },
      { members: ['read_page'] },
    );
    const record = { ...call('record', { text: 'filed' }, 'record'), name: 'record' };
    const turns = [[record, call('read_page', { tab_id: null, filter: 'all' }, 'read')], [catalog.final]];
    const client = new OpenAI({
      apiKey: 'synthetic-unused',
      baseURL: 'http://fixture.invalid/v1',
      maxRetries: 0,
      fetch: async (url, init) => {
        const output = turns[bodies.length];
        assert.ok(output, 'unexpected request');
        bodies.push(JSON.parse(init.body));
        const response = {
          id: `resp_${bodies.length}`,
          object: 'response',
          created_at: 0,
          model: '',
          status: 'completed',
          output,
        };
        return vector.stream
          ? new Response(sse(response), { headers: { 'content-type': 'text/event-stream' } })
          : Response.json(response);
      },
    });
    const runner = new ResponsesToolRunner({
      browser,
      functions: [
        {
          tool: catalog.record_tool,
          allowOutputOverride: true,
          execute(args) {
            effects.push(`function:${args.text}`);
            return args.text;
          },
        },
      ],
    });
    const iterator = runner.iterate(
      client,
      { model: '', input: 'Process the local fixture', store: false },
      { stream: vector.stream, eager: vector.eager, maxSteps: 3 },
    );
    try {
      const first = await iterator.next();
      assert.equal(first.done, false);
      const turn = first.value;
      assert.equal(turn.step, 1);
      assert.equal(turn.final, false);
      assert.equal(turn.toolsExecuted, vector.eager);
      assert.deepEqual(turn.attemptedCallIds, vector.eager ? ['record', 'read'] : []);
      assert.deepEqual(turn.completedCallIds, vector.eager ? ['record', 'read'] : []);
      assert.deepEqual(effects, vector.eager ? ['function:filed', 'read'] : []);
      assert.equal(bodies.length, 1);
      if (vector.scenario === 'supply') {
        const content = [
          { type: 'input_text', text: 'human result' },
          structuredClone(catalog.image),
          { type: 'input_file', file_id: 'file_fixture' },
        ];
        turn.supplyOutputs([{ type: 'function_call_output', call_id: 'record', output: content }]);
        content[0].text = 'changed later';
        turn.response.output[1].arguments = JSON.stringify({ tab_id: 'changed', filter: 'interactive' });
        turn.response.output[1].call_id = 'changed';
        const next = await iterator.next();
        assert.equal(next.done, false);
        assert.equal(next.value.final, true);
        assert.equal(next.value.response.output_text, 'Fixture complete');
        assert.deepEqual(effects, ['read']);
        assert.equal(bodies.length, 2);
        assert.deepEqual(next.value.attemptedCallIds, ['record', 'read']);
        assert.deepEqual(next.value.completedCallIds, ['record', 'read']);
        const history = bodies[1].input;
        assert.deepEqual(
          history.filter((item) => item.type === 'function_call_output').map((item) => item.call_id),
          ['record', 'read'],
        );
        assert.deepEqual(history.find((item) => item.type === 'function_call_output').output, [
          { type: 'input_text', text: 'human result' },
          catalog.image,
          { type: 'input_file', file_id: 'file_fixture' },
        ]);
        assert.ok(!JSON.stringify(history).includes('changed'));
        assert.throws(() => turn.supplyOutputs([]));
      } else if (vector.scenario === 'reject') {
        const valid = { type: 'function_call_output', call_id: 'record', output: 'accepted' };
        turn.supplyOutputs([valid]);
        assert.throws(() => turn.supplyOutputs([valid, { ...valid, call_id: 'unknown' }]));
        assert.deepEqual(effects, []);
      } else if (vector.scenario === 'eager') {
        assert.throws(() => turn.supplyOutputs([]));
      }
      await iterator.return();
      assert.throws(() => turn.supplyOutputs([]));
      if (vector.scenario !== 'supply') {
        assert.equal(bodies.length, 1);
        assert.deepEqual(effects, vector.eager ? ['function:filed', 'read'] : []);
      }
    } finally {
      await iterator.return();
    }
  }
  pending.push(...catalog.iteration.map((vector) => check(vector.id, () => iteration(vector))));
  async function ledgerCase(vector) {
    const { scenario } = vector;
    const bodies = [];
    const effects = [];
    const observations = [];
    const writes = [];
    let resumed = false;
    let saveFailure = true;
    const fail = () => {
      throw new Error(`synthetic ${scenario} callback failure`);
    };
    const browser = new BrowserToolset(
      {
        state() {
          observations.push('state');
          return fixtureState();
        },
        read_page() {
          effects.push('read');
          return 'r1: invoice';
        },
        click() {
          effects.push('click');
          if (scenario === 'browser-error') {
            fail();
          }
          return 'clicked';
        },
      },
      {
        members: ['read_page', 'click'],
        confirm() {
          observations.push('confirm');
          return scenario !== 'browser-refusal';
        },
      },
    );
    const native = new ComputerToolset(
      computerDriver({
        type(action) {
          effects.push(`native:${action.text}`);
        },
        wait() {
          if (scenario === 'native-partial') {
            fail();
          }
        },
        screenshot() {
          effects.push('native-shot');
          return { type: 'computer_screenshot', image_url: catalog.image.image_url };
        },
      }),
    );
    const read = call('read_page', { tab_id: null, filter: 'all' }, 'read');
    const record = { ...call('record', { text: 'filed' }, 'record'), name: 'record' };
    const nativeCall = structuredClone(catalog.native);
    if (scenario === 'native-partial') {
      nativeCall.actions.push({ type: 'wait' });
    }
    let batch = [record, read];
    if (['browser-error', 'browser-refusal', 'save-before-attempt'].includes(scenario)) {
      batch = [call('click', click.arguments, 'click'), record];
    }
    if (scenario === 'native-partial') {
      batch = [nativeCall, record];
    }
    if (['resume-boundary', 'invalid-registry'].includes(scenario)) {
      batch = [catalog.reasoning, record, read, nativeCall];
    }
    const runner = new ResponsesToolRunner({
      browser,
      computer: native,
      functions: [
        {
          tool: catalog.record_tool,
          execute(args) {
            effects.push(`function:${args.text}`);
            if (scenario === 'function-throw') {
              fail();
            }
            if (scenario === 'nested-error') {
              throw new ResponsesToolRunnerError('synthetic nested failure', ['child'], []);
            }
            return args.text;
          },
        },
      ],
    });
    const streaming = ['inspection', 'eager-interruption'].includes(scenario);
    const client = new OpenAI({
      apiKey: 'synthetic-unused',
      baseURL: 'http://fixture.invalid/v1',
      maxRetries: 2,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        if (scenario === 'retry-budget') {
          return new Response('{"error":{"message":"fixture retry","type":"server_error"}}', {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }
        const response = {
          id: `resp_${bodies.length}`,
          object: 'response',
          created_at: 0,
          model: '',
          status: 'completed',
          output: resumed || scenario === 'invalid-history' ? [catalog.final] : batch,
        };
        return new Response(
          streaming ? sse(response, scenario === 'eager-interruption') : JSON.stringify(response),
          {
            headers: { 'content-type': streaming ? 'text/event-stream' : 'application/json' },
          },
        );
      },
    });
    const save = (checkpoint) => {
      const attempting = checkpoint.phase === 'pending' && checkpoint.attempted_call_ids.length === 1;
      const returning = attempting && checkpoint.returned_call_ids.length === 1;
      if (saveFailure && scenario === 'save-before-attempt' && attempting) {
        fail();
      }
      if (saveFailure && scenario === 'save-after-return' && returning) {
        fail();
      }
      if (writes.length && checkpoint.revision <= writes.at(-1).revision) {
        fail();
      }
      writes.push(structuredClone(checkpoint));
      const boundary = checkpoint.phase === 'boundary' && checkpoint.returned_call_ids.length > 0;
      if (
        saveFailure &&
        ((scenario === 'lost-ack' && returning) ||
          (['resume-boundary', 'invalid-registry'].includes(scenario) && boundary))
      ) {
        fail();
      }
    };
    const params = { model: '', input: 'Process the local fixture', store: false };
    const options = {
      maxSteps: scenario === 'retry-budget' ? 1 : 3,
      stream: streaming,
      eager: scenario === 'eager-interruption',
      ledger: { runId: 'fixture-run', save },
    };
    if (scenario === 'invalid-history') {
      const historical = {
        type: 'computer_call_output',
        call_id: nativeCall.call_id,
        output: { type: 'computer_screenshot', image_url: catalog.image.image_url },
      };
      const history = [nativeCall, historical, { role: 'user', content: 'Current fixture' }];
      const success = await runner.run(client, { ...params, input: history }, options);
      assert.equal(success.output_text, 'Fixture complete');
      const count = [bodies.length, writes.length, effects.length];
      for (const output of [
        {},
        { type: 'computer_screenshot' },
        { type: 'computer_screenshot', image_url: ' ' },
      ]) {
        // Each rejection must leave this case's same transport and recorder untouched before the next input.
        // oxlint-disable-next-line no-await-in-loop
        await assert.rejects(
          runner.run(client, { ...params, input: [nativeCall, { ...historical, output }] }, options),
        );
        assert.deepEqual([bodies.length, writes.length, effects.length], count);
      }
      return;
    }
    if (scenario === 'inspection') {
      const iterator = runner.iterate(client, params, options);
      const next = await iterator.next();
      const turn = next.value;
      assert.equal(turn.toolsExecuted, false);
      await iterator.return();
      assert.throws(() => turn.supplyOutputs([]));
    } else {
      await assert.rejects(runner.run(client, params, options), (error) => {
        assert.ok(error instanceof ResponsesToolRunnerError);
        if (['function-throw', 'nested-error', 'save-after-return', 'lost-ack'].includes(scenario)) {
          assert.deepEqual(error.attemptedCallIds, ['record']);
        }
        if (['save-after-return', 'lost-ack'].includes(scenario)) {
          assert.deepEqual(error.completedCallIds, ['record']);
        }
        return true;
      });
    }
    assert.equal(bodies.length, 1);
    assert.equal(client.maxRetries, 2);
    const previous = structuredClone(writes.at(-1));
    assert.ok(previous);
    saveFailure = false;
    resumed = true;
    const fresh = [{ role: 'user', content: [{ type: 'input_text', text: 'Fresh fixture observation' }] }];
    const resume = { ledger: { runId: 'fixture-run', save, resumeFrom: previous } };
    if (scenario === 'resume-boundary') {
      assert.equal(previous.phase, 'boundary');
      assert.deepEqual(previous.returned_call_ids, ['record', 'read', 'native_one']);
      const performed = [...effects];
      const final = await runner.run(client, { ...params, input: fresh }, resume);
      assert.equal(final.output_text, 'Fixture complete');
      assert.deepEqual(effects, performed);
      assert.deepEqual(bodies[1].input, [...previous.history, ...fresh]);
      assert.equal(writes.at(-1).max_steps, 3);
      assert.equal(writes.at(-1).consumed_requests, 2);
      const returned = bodies[1].input.filter((entry) => entry.type?.endsWith('_call_output'));
      assert.deepEqual(
        returned.map((entry) => entry.call_id),
        ['record', 'read', 'native_one'],
      );
      assert.deepEqual(returned.at(-1).output, {
        type: 'computer_screenshot',
        image_url: catalog.image.image_url,
      });
      await assert.rejects(runner.run(client, { ...params, input: fresh }, resume));
      assert.equal(bodies.length, 2);
      assert.deepEqual(effects, performed);
      return;
    }
    if (scenario === 'invalid-registry') {
      previous.tools = previous.tools.filter((declaration) => declaration.type !== 'computer');
    } else if (scenario === 'retry-budget') {
      assert.equal(previous.phase, 'boundary');
      assert.equal(previous.consumed_requests, 1);
    } else {
      assert.equal(previous.phase, 'pending');
      const expected = {
        'function-throw': ['function:filed'],
        'nested-error': ['function:filed'],
        'save-before-attempt': [],
        'save-after-return': ['function:filed'],
        'lost-ack': ['function:filed'],
        'browser-error': ['click'],
        'browser-refusal': [],
        'native-partial': ['native:Receipt'],
        inspection: [],
        'eager-interruption': ['function:filed', 'read'],
      };
      assert.deepEqual(effects, expected[scenario]);
      if (['inspection', 'save-before-attempt'].includes(scenario)) {
        assert.deepEqual(observations, []);
      }
      if (['lost-ack', 'browser-error', 'browser-refusal'].includes(scenario)) {
        assert.equal(previous.returned_call_ids.length, 1);
      }
      if (['function-throw', 'nested-error', 'save-after-return', 'native-partial'].includes(scenario)) {
        assert.equal(previous.returned_call_ids.length, 0);
      }
    }
    const count = [bodies.length, writes.length, effects.length, observations.length];
    await assert.rejects(runner.run(client, { ...params, input: fresh }, resume));
    assert.deepEqual([bodies.length, writes.length, effects.length, observations.length], count);
  }
  pending.push(...catalog.ledger.map((vector) => check(vector.id, () => ledgerCase(vector))));
  async function budgetCase(vector) {
    const { scenario, stream } = vector;
    const bodies = [];
    const writes = [];
    const effects = [];
    const choices = [];
    const controller = new AbortController();
    const { promise: waiting, resolve: entered } = Promise.withResolvers();
    const { promise: blocked, resolve: release } = Promise.withResolvers();
    const photo = (id) => call('screenshot', { tab_id: 'one' }, id);
    const native = (id) => ({ ...structuredClone(catalog.native), id: `item_${id}`, call_id: id });
    const record = { ...call('record', { text: 'filed' }, 'old'), name: 'record' };
    const large = 'PRIVATE_FULL_HISTORY '.repeat(260);
    const browser = new BrowserToolset(
      {
        state: fixtureState,
        screenshot() {
          effects.push('browser');
          return structuredClone(catalog.image);
        },
      },
      { members: ['screenshot'] },
    );
    const computer = new ComputerToolset(
      computerDriver({
        type() {
          effects.push('native-type');
        },
        screenshot() {
          effects.push('native-shot');
          return { type: 'computer_screenshot', image_url: catalog.image.image_url };
        },
      }),
    );
    const runner = new ResponsesToolRunner({
      browser,
      computer,
      functions: [
        {
          tool: catalog.record_tool,
          execute() {
            effects.push('record');
            return [{ type: 'input_text', text: large }, structuredClone(catalog.image)];
          },
        },
      ],
    });
    const client = new OpenAI({
      apiKey: 'synthetic-unused',
      baseURL: 'http://fixture.invalid/v1',
      maxRetries: 2,
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        bodies.push(request);
        let output = [catalog.final];
        if (scenario === 'bounded') {
          if (bodies.length === 1) {
            output = [catalog.reasoning, photo('a'), native('n1'), record];
          }
          if (bodies.length === 2) {
            output = [photo('b'), native('n2')];
          }
        } else if (scenario === 'replay') {
          output = [record];
        } else if (scenario === 'resume' && bodies.length === 1) {
          output = [record];
        }
        const response = {
          id: `resp_${bodies.length}`,
          object: 'response',
          created_at: 0,
          model: '',
          status: 'completed',
          output,
        };
        return new Response(stream ? sse(response, false) : JSON.stringify(response), {
          headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' },
        });
      },
    });
    const save = (value) => writes.push(structuredClone(value));
    const compact = async (snapshot) => {
      const ids = [...snapshot.eligibleCallIds];
      choices.push(ids);
      snapshot.eligibleCallIds.push('checked');
      snapshot.history.length = 0;
      if (scenario === 'cancel') {
        entered();
        await blocked;
      }
      if (scenario === 'invalid') {
        return { dropCallIds: ['old', 'old'] };
      }
      if (scenario === 'protected') {
        return { dropCallIds: ['checked'] };
      }
      return { dropCallIds: ids, summary: 'Fixture summary' };
    };
    const params = { model: '', input: 'Process the local fixture', store: false };
    const options = {
      stream,
      signal: controller.signal,
      maxSteps: scenario === 'resume' ? 2 : 4,
      ledger: { runId: 'budget-fixture', save },
      contextBudget: { maxInputBytes: 3600, maxInputImages: 2, compact },
    };
    if (['invalid', 'protected', 'replay', 'cancel'].includes(scenario)) {
      params.input = [
        { role: 'user', content: 'Process the local fixture' },
        record,
        { type: 'function_call_output', call_id: 'old', output: large },
      ];
      if (scenario === 'protected') {
        const checked = native('checked');
        checked.pending_safety_checks = [{ id: 'check', code: 'fixture', message: 'confirm' }];
        params.input.push(
          photo('latest'),
          {
            type: 'function_call_output',
            call_id: 'latest',
            output: [structuredClone(catalog.image)],
          },
          checked,
          {
            type: 'computer_call_output',
            call_id: 'checked',
            acknowledged_safety_checks: structuredClone(checked.pending_safety_checks),
            output: { type: 'computer_screenshot', image_url: catalog.image.image_url },
          },
          native('current'),
          {
            type: 'computer_call_output',
            call_id: 'current',
            output: { type: 'computer_screenshot', image_url: catalog.image.image_url },
          },
        );
        options.contextBudget.maxInputImages = 3;
      }
    }
    if (scenario === 'cancel') {
      const running = runner.run(client, params, options);
      await waiting;
      controller.abort();
      assert.deepEqual([writes.length, bodies.length, effects.length], [0, 0, 0]);
      release();
      await assert.rejects(running);
    } else if (['invalid', 'protected', 'replay'].includes(scenario)) {
      await assert.rejects(runner.run(client, params, options));
    } else {
      const result = await runner.run(client, params, options);
      assert.equal(result.output_text, 'Fixture complete');
    }
    assert.ok(choices.length > 0, 'policy must have actually run');
    if (['invalid', 'protected', 'cancel'].includes(scenario)) {
      assert.deepEqual([writes.length, bodies.length, effects.length], [0, 0, 0]);
      assert.deepEqual(choices, [['old']]);
      return;
    }
    for (const request of bodies) {
      assert.equal(request.truncation, 'disabled');
      assert.ok(Buffer.byteLength(JSON.stringify(request.input)) <= 3600);
      let pictures = 0;
      for (const value of request.input) {
        if (value.type === 'computer_call_output') {
          pictures += 1;
        } else if (value.type === 'function_call_output' && Array.isArray(value.output)) {
          pictures += value.output.filter((block) => block.type === 'input_image').length;
        }
      }
      assert.ok(pictures <= 2);
    }
    const finalInput = bodies.at(-1).input;
    assert.ok(!finalInput.some((item) => item.call_id === 'old'));
    const receipt = finalInput.find(
      (item) =>
        item.role === 'user' &&
        typeof item.content === 'string' &&
        item.content.startsWith('Runner receipt:') &&
        item.content.includes('old'),
    );
    assert.ok(receipt);
    assert.ok(receipt.content.includes('external success is unverified'));
    assert.ok(!receipt.content.includes(large) && !receipt.content.includes(catalog.image.image_url));
    assert.equal(receipt.call_id, undefined);
    assert.equal(Object.keys(writes.at(-1)).length, 14);
    assert.ok(JSON.stringify(writes.at(-1).history).includes('PRIVATE_FULL_HISTORY'));
    assert.ok(!JSON.stringify(writes.at(-1).history).includes('Runner receipt:'));
    if (scenario === 'bounded') {
      assert.deepEqual(choices, [['old'], ['a', 'n1', 'old']]);
      assert.deepEqual(effects, [
        'browser',
        'native-type',
        'native-shot',
        'record',
        'browser',
        'native-type',
        'native-shot',
      ]);
      assert.deepEqual(
        finalInput.filter((item) => item.type?.endsWith('_call')).map((item) => item.call_id),
        ['b', 'n2'],
      );
      assert.ok(finalInput.some((item) => item.type === 'reasoning'));
      assert.deepEqual(writes.at(-1).returned_call_ids, ['a', 'n1', 'old', 'b', 'n2']);
    } else if (scenario === 'replay') {
      assert.deepEqual(effects, []);
      assert.equal(bodies.length, 1);
    } else if (scenario === 'resume') {
      assert.deepEqual(effects, ['record']);
      const previous = writes.find(
        (value) =>
          value.phase === 'boundary' &&
          value.consumed_requests === 1 &&
          value.returned_call_ids.includes('old'),
      );
      assert.ok(previous);
      const count = bodies.length;
      const resume = {
        stream,
        ledger: { runId: 'budget-fixture', save, resumeFrom: previous },
        contextBudget: options.contextBudget,
      };
      await runner.run(client, { ...params, input: 'Fresh observed fixture' }, resume);
      assert.equal(bodies.length, count + 1);
      assert.deepEqual(bodies.at(-1).input.at(-1), { role: 'user', content: 'Fresh observed fixture' });
      assert.deepEqual(effects, ['record']);
      assert.equal(writes.at(-1).max_steps, 2);
      assert.equal(writes.at(-1).consumed_requests, 2);
      const exhausted = writes.findLast(
        (value) => value.phase === 'boundary' && value.consumed_requests === 2,
      );
      assert.ok(exhausted);
      const before = [bodies.length, writes.length, choices.length, effects.length];
      await assert.rejects(
        runner.run(
          client,
          { ...params, input: 'Fresh again' },
          {
            ...resume,
            ledger: { runId: 'budget-fixture', save, resumeFrom: exhausted },
          },
        ),
      );
      assert.deepEqual([bodies.length, writes.length, choices.length, effects.length], before);
    }
  }
  pending.push(...catalog.budget.map((vector) => check(vector.id, () => budgetCase(vector))));
  async function richRead(vector) {
    const base = structuredClone(catalog.rich_reads.report);
    const expected = structuredClone(base);
    const events = [];
    let returned = base;
    if (vector.scenario === 'legacy') {
      returned = JSON.stringify({ ...base, owner_private: 'SYNTHETIC_PRIVATE' });
    } else if (vector.scenario === 'scalar') {
      base.text = '\uD800';
    } else if (vector.scenario === 'aggregate') {
      returned = { version: 1, text: '', elements: [], omitted: [] };
      returned.text = 'Visible 😀\n'.repeat(20_000);
    }
    if (typeof returned !== 'string') {
      returned.private_raw = {
        toJSON() {
          throw new Error('SYNTHETIC_PRIVATE');
        },
      };
      if (returned.elements.length) {
        returned.elements[0].record_id = Symbol('SYNTHETIC_PRIVATE');
        returned.elements[0].options[0].raw_option = returned.private_raw;
      }
    }
    const driver = {
      state() {
        events.push('state');
        if (events.length === 3 && vector.scenario === 'state') {
          throw new Error('SYNTHETIC_PRIVATE');
        }
        if (events.length === 3 && vector.scenario === 'projection') {
          base.text = 'SYNTHETIC_PRIVATE';
          base.elements[0].ref = 'wrong_after_final_state';
          base.elements[0].options[0].value = 'SYNTHETIC_PRIVATE';
          base.omitted.push('private');
        }
        return fixtureState();
      },
      [vector.member]() {
        events.push('read');
        return returned;
      },
    };
    const browser = new BrowserToolset(driver, { members: [vector.member] });
    const args = catalog.browser.find((item) => item.member === vector.member).arguments;
    const action = call(vector.member, args, 'read-contract');
    if (['scalar', 'text-refs', 'state'].includes(vector.scenario)) {
      const message =
        vector.scenario === 'state' ? 'Browser state report failed.' : 'Browser read report failed.';
      await assert.rejects(browser.execute(action), (error) => {
        assert.equal(error.message, message);
        return true;
      });
      assert.deepEqual(events, vector.scenario === 'state' ? ['state', 'read', 'state'] : ['state', 'read']);
      return;
    }
    const output = body(await browser.execute(action));
    assert.equal(output.ok, true);
    assert.deepEqual(events, ['state', 'read', 'state']);
    if (vector.scenario === 'projection') {
      assert.deepEqual(output.result, expected);
      assert.ok(!JSON.stringify(output).includes('SYNTHETIC_PRIVATE'));
    } else if (vector.scenario === 'legacy') {
      assert.equal(output.result, returned);
    } else {
      assert.equal(output.result.text, returned.text);
      assert.ok(!JSON.stringify(output).includes('private_raw'));
      returned.text += '\0';
      events.length = 0;
      const next = body(await browser.execute(action));
      assert.equal(next.result.text, returned.text);
      assert.ok(!JSON.stringify(next).includes('private_raw'));
      assert.deepEqual(events, ['state', 'read', 'state']);
    }
  }
  function selectiveProposal(variant, defaultEarlyPolicy) {
    const nativeNames = ['ordinary', 'native'].includes(variant);
    const ordinary = (name, id) => ({ ...call(name, { text: id }, id), name });
    const fast = ordinary('fast', 'one');
    const slow = ordinary('slow', 'two');
    const search = {
      type: 'web_search_call',
      id: 'ws_fixture',
      status: 'completed',
      action: { type: 'search', query: 'fixture' },
    };
    let batch = [fast, slow];
    if (['ordered', 'local-ordered'].includes(variant)) {
      batch = [
        fast,
        slow,
        catalog.reasoning,
        { ...catalog.final, id: 'commentary', phase: 'commentary' },
        ...(variant === 'ordered' ? [search] : []),
        ordinary('fast', 'three'),
      ];
    } else if (['omitted', 'null', 'empty'].includes(variant)) {
      batch = [fast];
    } else if (nativeNames) {
      const native = structuredClone(catalog.native);
      native.pending_safety_checks = [{ id: 'safe', code: 'fixture', message: 'confirm' }];
      const named = ordinary('computer', 'ordinary');
      batch = variant === 'native' ? [native, named] : [named, native];
    } else if (variant === 'undeclared') {
      batch.push({
        type: 'file_search_call',
        id: 'fs_fixture',
        status: 'completed',
        queries: ['fixture'],
        results: [],
      });
    }
    let policy = { functions: nativeNames ? ['computer'] : ['fast'] };
    if (variant === 'null') {
      policy = null;
    } else if (variant === 'empty') {
      policy = {};
    } else if (variant === 'native') {
      policy = { computer: true };
    }
    return { batch, policy: defaultEarlyPolicy || variant === 'omitted' ? undefined : policy };
  }
  async function selectiveRun(variant, defaultEarlyPolicy) {
    const bodies = [];
    const effects = [];
    const approvals = [];
    const writes = [];
    const nativeNames = ['ordinary', 'native'].includes(variant);
    const declarations = nativeNames ? ['computer'] : ['fast', 'slow'];
    const functions = declarations.map((name) => ({
      tool: { ...catalog.record_tool, name },
      allowOutputOverride: true,
      execute(args) {
        effects.push(`${name}:${args.text}`);
        return args.text;
      },
    }));
    const computer = new ComputerToolset(
      computerDriver({
        type(action) {
          effects.push(`native:${action.text}`);
        },
        screenshot() {
          effects.push('native-shot');
          return { type: 'computer_screenshot', image_url: catalog.image.image_url };
        },
      }),
    );
    const { batch, policy } = selectiveProposal(variant, defaultEarlyPolicy);
    const runner = new ResponsesToolRunner({
      computer,
      functions,
      ...(policy === undefined ? {} : { earlyExecution: policy }),
    });
    const client = new OpenAI({
      apiKey: 'synthetic-unused',
      baseURL: 'http://fixture.invalid/v1',
      maxRetries: 0,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        const output = bodies.length === 1 ? batch : [catalog.final];
        const completed = structuredClone(output);
        if (variant === 'changed' && bodies.length === 1) {
          completed[1].arguments = JSON.stringify({ text: 'retargeted' });
        }
        const response = {
          id: `resp_${bodies.length}`,
          object: 'response',
          created_at: 0,
          model: '',
          status: 'completed',
          output,
        };
        return new Response(sse(response, false, completed), {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const params = {
      model: '',
      input: 'Process the local fixture',
      store: false,
      ...(variant === 'ordered' ? { tools: [{ type: 'web_search' }] } : {}),
    };
    const ledger = {
      runId: 'selective',
      save(value) {
        writes.push(structuredClone(value));
      },
    };
    const options = {
      stream: true,
      eager: true,
      maxSteps: 3,
      ...(variant === 'pending' ? { ledger } : {}),
      computerOptions: {
        approveSafetyChecks() {
          approvals.push('safety');
          return true;
        },
        beforeAction() {
          approvals.push('action');
          return true;
        },
      },
    };
    const iterator = runner.iterate(client, params, options);
    try {
      if (['changed', 'undeclared'].includes(variant)) {
        await assert.rejects(iterator.next(), (error) => {
          assert.deepEqual(error.attemptedCallIds, ['one']);
          assert.deepEqual(error.completedCallIds, ['one']);
          return true;
        });
        assert.deepEqual(effects, ['fast:one']);
        assert.equal(bodies.length, 1);
        return;
      }
      const { value: turn, done } = await iterator.next();
      assert.equal(done, false);
      assert.equal(turn.final, false);
      let firstID = ['one'];
      if (['empty', 'ordered'].includes(variant)) {
        firstID = [];
      } else if (nativeNames) {
        firstID = [variant === 'native' ? 'native_one' : 'ordinary'];
      }
      assert.deepEqual(turn.attemptedCallIds, firstID);
      assert.deepEqual(turn.completedCallIds, firstID);
      assert.equal(turn.toolsExecuted, firstID.length > 0);
      assert.deepEqual(approvals, variant === 'native' ? ['safety', 'action', 'action'] : []);
      if (['empty', 'omitted', 'null'].includes(variant)) {
        assert.deepEqual(effects, variant === 'empty' ? [] : ['fast:one']);
        if (variant !== 'empty') {
          assert.throws(() => turn.supplyOutputs([]));
        }
        await iterator.return();
        assert.equal(bodies.length, 1);
        assert.throws(() => turn.supplyOutputs([]));
        return;
      }
      if (variant === 'pending') {
        const previous = writes.at(-1);
        assert.equal(previous.phase, 'pending');
        assert.equal(previous.pending_items.length, batch.length);
        for (const [index, item] of batch.entries()) {
          // Strict function tools may add SDK parsed arguments. The native wire fields must remain exact.
          for (const key of Object.keys(item)) {
            assert.deepEqual(previous.pending_items[index][key], item[key]);
          }
        }
        assert.deepEqual(previous.attempted_call_ids, ['one']);
        assert.deepEqual(previous.returned_call_ids, ['one']);
        await iterator.return();
        const counts = [bodies.length, writes.length, effects.length, approvals.length];
        await assert.rejects(
          runner.run(
            client,
            { ...params, input: 'Fresh fixture observation' },
            {
              ...options,
              ledger: { ...ledger, resumeFrom: previous },
            },
          ),
        );
        assert.deepEqual([bodies.length, writes.length, effects.length, approvals.length], counts);
        return;
      }
      if (['ordered', 'local-ordered'].includes(variant)) {
        assert.deepEqual(
          effects,
          firstID.map((id) => `fast:${id}`),
        );
        const supplied = { type: 'function_call_output', call_id: 'two', output: 'human result' };
        turn.supplyOutputs([supplied]);
        const forbiddenID = { ordered: 'missing', 'local-ordered': 'one' }[variant];
        assert.throws(() => turn.supplyOutputs([supplied, { ...supplied, call_id: forbiddenID }]));
      } else {
        assert.deepEqual(
          effects,
          variant === 'native' ? ['native:Receipt', 'native-shot'] : ['computer:ordinary'],
        );
      }
      const final = await iterator.next();
      assert.equal(final.done, false);
      assert.equal(final.value.final, true);
      assert.equal(bodies.length, 2);
      const history = bodies[1].input;
      const returned = history.filter((item) => item.type?.endsWith('_call_output'));
      const callIDs = batch
        .filter((item) => ['function_call', 'computer_call'].includes(item.type))
        .map((item) => item.call_id);
      assert.deepEqual(final.value.attemptedCallIds, callIDs);
      assert.deepEqual(final.value.completedCallIds, callIDs);
      assert.deepEqual(
        returned.map((item) => item.call_id),
        callIDs,
      );
      assert.deepEqual(
        history.filter((item) => item.id).map((item) => item.id),
        batch.map((item) => item.id),
      );
      if (['ordered', 'local-ordered'].includes(variant)) {
        assert.deepEqual(effects, ['fast:one', 'fast:three']);
        assert.equal(returned[1].output, 'human result');
      } else {
        assert.deepEqual(approvals, ['safety', 'action', 'action']);
        assert.deepEqual(
          effects,
          variant === 'native'
            ? ['native:Receipt', 'native-shot', 'computer:ordinary']
            : ['computer:ordinary', 'native:Receipt', 'native-shot'],
        );
        assert.deepEqual(returned.find((item) => item.type === 'computer_call_output').output, {
          type: 'computer_screenshot',
          image_url: catalog.image.image_url,
        });
      }
      assert.throws(() => turn.supplyOutputs([]));
    } finally {
      await iterator.return();
    }
  }
  async function selectiveCase(vector) {
    const variants = {
      'prefix-and-suffix': ['ordered', 'local-ordered'],
      'empty-versus-omitted': ['omitted', 'null', 'empty'],
      'native-names': ['ordinary', 'native'],
      'pending-ledger': ['pending'],
      'changed-completion': ['changed', 'undeclared'],
      'server-default-override': ['ordered'],
    }[vector.scenario];
    // Variants own mutable effects and a single runner; settle each iterator before opening the next.
    for (const variant of variants) {
      // oxlint-disable-next-line no-await-in-loop -- Keep the per-run close-before-next invariant.
      await selectiveRun(variant, vector.scenario === 'server-default-override');
    }
  }
  pending.push(
    ...catalog.rich_reads.cases.map((vector) => check(vector.id, () => richRead(vector))),
    ...catalog.selective.map((vector) => check(vector.id, () => selectiveCase(vector))),
  );
  await Promise.all(pending);
  for (const id of catalog.boundary_ids) {
    assert.equal(checks.filter((c) => c.id === id).length, 1, id);
  }
  const report = {
    runtime: process.version,
    format: mode,
    installed: pkg,
    archive,
    archiveSha256: sha(archive),
    source: checkout,
    sourceHead: git('rev-parse', 'HEAD').toString().trim(),
    packageSourceHead: git('rev-parse', '--verify', `${packageHead}^{commit}`).toString().trim(),
    helperHashes: hashes,
    catalogSha256: sha(catalogFile),
    checks,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (checks.some((x) => !x.pass)) {
    process.exitCode = 1;
  }
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
