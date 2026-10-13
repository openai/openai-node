// Script-level UI regression receipt. Uses the actual dashboard script, a minimal
// DOM, and controlled fetch completion order. This does not exercise Chromium.
// From examples/: node browser-use-demo/exercise-dashboard.mjs [path/to/index.html]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const sourcePath = process.argv[2]
  ? nodePath.resolve(process.argv[2])
  : fileURLToPath(new URL('index.html', import.meta.url));
const html = await readFile(sourcePath, 'utf-8');
const source = html.match(/<script nonce="__NONCE__">(?<source>[\s\S]*?)<\/script>/u)?.groups?.source;
assert.ok(source, 'Expected to find the dashboard inline script');

function dashboard(fetch) {
  const nodes = new Map();
  const handlers = new Map();
  let created = 0;
  function get(id) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        style: {},
        value: { environment: 'browser', api: 'responses', mode: 'live' }[id] ?? '',
        setAttribute(name, value) {
          this[name] = value;
        },
        removeAttribute(name) {
          this[name] = undefined;
        },
        // The real script registers DOM callbacks; the exercise must await those exact handlers.
        // oxlint-disable-next-line promise/prefer-await-to-callbacks
        addEventListener(event, cb) {
          handlers.set(`${id}:${event}`, cb);
        },
        replaceChildren(...children) {
          this.children = children;
        },
        append(child) {
          this.children ??= [];
          this.children.push(child);
        },
        getBoundingClientRect() {
          return { left: 40, top: 80, width: 512, height: 360, right: 552, bottom: 440 };
        },
        querySelector(selector) {
          return get(`${id}:${selector}`);
        },
        naturalWidth: 1024,
        naturalHeight: 720,
      });
    }
    return nodes.get(id);
  }
  const context = vm.createContext({
    document: {
      getElementById: get,
      querySelector: get,
      querySelectorAll: () => [],
      createElement(tag) {
        created += 1;
        return get(`${tag}:${created}`);
      },
    },
    URL,
    URLSearchParams,
    location: { hash: '#token=local-test', pathname: '/', search: '' },
    history: {
      replaceState(_state, _title, url) {
        get('history').value = url;
      },
    },
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Emulate the DOM event API for the actual script.
    addEventListener(type, callback) {
      handlers.set(`window:${type}`, callback);
    },
    Blob,
    Date,
    AbortSignal,
    Image: class {
      naturalWidth = 1024;
      naturalHeight = 720;
      async decode() {
        return this;
      }
    },
    // Leave polling under test control instead of scheduling real timers.
    setTimeout() {
      return 0;
    },
    fetch,
  });
  const ready = vm.runInContext(source, context, { filename: sourcePath });
  return {
    get,
    ready,
    render(run) {
      context.testRun = run;
      return vm.runInContext('render(testRun)', context);
    },
    poll() {
      return vm.runInContext('poll()', context);
    },
    clickStart() {
      return handlers.get('start:click')();
    },
    clickApprove() {
      return handlers.get('approve:click')();
    },
    click(id, event = {}) {
      const listener = handlers.get(`${id}:click`);
      assert.ok(listener, `Expected ${id} click handler on the actual page`);
      return listener(event);
    },
    selectCheckpoint(value) {
      get('checkpoint').value = String(value);
      const listener = handlers.get('checkpoint:change');
      assert.ok(listener, 'Expected saved checkpoint selector on the actual page');
      return listener();
    },
    selectTab(value) {
      get('browser-tab').value = value;
      return handlers.get('browser-tab:change')();
    },
    selectEnvironment(value) {
      get('environment').value = value;
      return handlers.get('environment:change')();
    },
  };
}

const common = {
  taskId: 'support',
  environment: 'browser',
  api: 'decisions',
  mode: 'rehearsal',
  elapsedMs: 1,
  requests: 0,
  events: [],
  owner: 'agent',
  ownerVersion: 0,
  humanInputBusy: false,
  browser: { tabId: 'tab_1', sequence: 2, role: 'Task', tabs: [{ id: 'tab_1', role: 'Task' }] },
  screenshotBinding: { tabId: 'tab_1', sequence: 2, role: 'Task' },
};
const json = (value) => Response.json(value);
const failures = [];

async function check(name, verify) {
  try {
    await verify();
    console.log('PASS', name);
  } catch (error) {
    failures.push(name);
    console.error('FAIL', name, error.message);
  }
}

await check('new run renders pixels when both pages have the same frame sequence', async () => {
  const images = [];
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      return json({ liveAvailable: false, run: null });
    }
    images.push(path);
    return new Response('image bytes');
  });
  const view = { status: 'live', sequence: 5, at: Date.now() };
  await ui.ready;
  await ui.render({ ...common, id: 'old', status: 'running', view });
  assert.equal(ui.get('screen').style.display, 'block', 'old page should first be visible');
  const replacement = { ...common, id: 'new', status: 'running', view };
  await ui.render(replacement);
  // No further paint: another poll must not hide or duplicate the page.
  await ui.render(replacement);
  assert.deepEqual(images, [
    '/api/view?run=old&tabId=tab_1&sequence=2',
    '/api/view?run=new&tabId=tab_1&sequence=2',
  ]);
  assert.equal(ui.get('screen').style.display, 'block');
  assert.equal(ui.get('empty').hidden, true);
  assert.equal(ui.get('view-kind').textContent, 'Live browser view · view only');
});

await check(
  'a delayed old poll cannot unlock controls after Start and only a fresh poll shows the new run',
  async () => {
    const start = Promise.withResolvers();
    const state = Promise.withResolvers();
    let stateCalls = 0;
    const old = {
      ...common,
      id: 'old',
      status: 'complete',
      owner: 'stopped',
      screenshotAt: 123,
      view: { status: 'closed', sequence: 5 },
    };
    const next = { ...common, id: 'new', status: 'running', view: { status: 'starting', sequence: 0 } };
    const ui = dashboard(async (path) => {
      if (path === '/api/state') {
        stateCalls += 1;
        if (stateCalls === 1) {
          return json({ liveAvailable: false, run: null });
        }
        return stateCalls === 2 ? state.promise : json({ liveAvailable: false, run: next });
      }
      if (path === '/api/start') {
        return start.promise;
      }
      return new Response('image bytes');
    });
    await ui.ready;
    await ui.render(old);
    const starting = ui.clickStart();
    // Begin after Start admission while its POST is pending.
    const polling = ui.poll();
    start.resolve(json(next));
    await starting;
    assert.equal(ui.get('status').textContent, 'Verified');
    assert.equal(ui.get('start').disabled, true);
    // An old GET arrives after the new POST response.
    state.resolve(json({ run: old }));
    await polling;
    assert.equal(ui.get('status').textContent, 'Verified');
    assert.equal(ui.get('start').disabled, true, 'a poll from before POST settlement must not unlock Start');
    await ui.poll();
    assert.equal(ui.get('status').textContent, 'running');
    assert.equal(ui.get('start').disabled, true);
    assert.equal(ui.get('view-kind').textContent, 'Opening browser view…');
  },
);

const pendingApproval = {
  ...common,
  id: 'current',
  status: 'running',
  view: { status: 'live', sequence: 5, at: Date.now() },
  approval: { id: 'approval-1', label: 'Save the reservation' },
};

await Promise.all(
  ['http', 'network'].map((failure) =>
    check(
      `state ${failure} failure removes stale pixels and approvals until a fresh same-frame state`,
      async () => {
        let stateFails = false;
        const images = [];
        const approvals = [];
        const ui = dashboard(async (path, options) => {
          if (path === '/api/state') {
            if (!stateFails) {
              return json({ liveAvailable: false, run: pendingApproval });
            }
            if (failure === 'http') {
              return Response.json({ error: 'Unavailable' }, { status: 503 });
            }
            throw new TypeError('Network unavailable');
          }
          if (path === '/api/approval') {
            approvals.push(JSON.parse(options.body));
            return json({});
          }
          images.push(path);
          return new Response('image bytes');
        });
        await ui.ready;
        assert.equal(ui.get('screen').style.display, 'block');
        assert.equal(ui.get('approval').hidden, false);
        stateFails = true;
        await ui.poll();
        assert.equal(ui.get('screen').style.display, 'none', 'failure must hide previous pixels');
        assert.equal(ui.get('screen').src, undefined);
        assert.equal(ui.get('status').textContent, 'Connection lost');
        assert.equal(ui.get('approval').hidden, true);
        assert.equal(ui.get('start').disabled, true);
        assert.equal(ui.get('stop').disabled, true);
        await ui.clickApprove();
        assert.deepEqual(approvals, [], 'no cached approval may be submitted while disconnected');
        const beforeRecovery = images.length;
        stateFails = false;
        await ui.poll();
        assert.equal(images.length, beforeRecovery + 1, 'recovery must fetch the unchanged current frame');
        assert.equal(ui.get('screen').style.display, 'block');
        assert.equal(ui.get('view-kind').textContent, 'Live browser view · view only');
        assert.equal(ui.get('status').textContent, 'running');
        assert.equal(ui.get('start').disabled, true);
        assert.equal(ui.get('stop').disabled, false);
        assert.equal(ui.get('approval').hidden, false);
        await ui.clickApprove();
        assert.deepEqual(approvals, [
          {
            runId: 'current',
            ownerVersion: 0,
            tabId: 'tab_1',
            sequence: 2,
            approvalId: 'approval-1',
            approved: true,
          },
        ]);
      },
    ),
  ),
);

await Promise.all(
  ['http', 'network'].map((failure) =>
    check(`image ${failure} failure clears pixels and retries the same frame`, async () => {
      let imageFails = false;
      let run = pendingApproval;
      const images = [];
      const ui = dashboard(async (path) => {
        if (path === '/api/state') {
          return json({ liveAvailable: false, run });
        }
        images.push(path);
        if (imageFails) {
          if (failure === 'http') {
            return Response.json({ error: 'Unavailable' }, { status: 410 });
          }
          throw new TypeError('Image disconnected');
        }
        return new Response('image bytes');
      });
      await ui.ready;
      assert.equal(ui.get('screen').style.display, 'block');
      run = { ...pendingApproval, view: { ...pendingApproval.view, sequence: 6 } };
      imageFails = true;
      await ui.poll();
      assert.equal(ui.get('screen').style.display, 'none');
      assert.equal(ui.get('view-kind').textContent, 'Browser view unavailable');
      assert.equal(ui.get('snapshot-time').textContent, '');
      assert.equal(ui.get('status').textContent, 'running', 'state still reports the run');
      const beforeRecovery = images.length;
      imageFails = false;
      await ui.poll();
      assert.equal(images.length, beforeRecovery + 1);
      assert.equal(ui.get('screen').style.display, 'block');
      assert.equal(ui.get('view-kind').textContent, 'Live browser view · view only');
    }),
  ),
);

await check('saved screenshots recover as saved after an image failure', async () => {
  let imageFails = false;
  let run = pendingApproval;
  const images = [];
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      return json({ liveAvailable: false, run });
    }
    images.push(path);
    return imageFails ? new Response('', { status: 404 }) : new Response('image bytes');
  });
  await ui.ready;
  run = {
    ...common,
    id: 'current',
    status: 'complete',
    owner: 'stopped',
    result: 'verified',
    view: { status: 'closed', sequence: 5 },
    screenshotAt: 123,
  };
  imageFails = true;
  await ui.poll();
  assert.equal(ui.get('screen').style.display, 'none', 'never relabel old live pixels as saved');
  assert.equal(ui.get('view-kind').textContent, 'Saved screenshot unavailable');
  assert.equal(ui.get('approval').hidden, true);
  assert.equal(ui.get('status').textContent, 'Verified');
  imageFails = false;
  await ui.poll();
  assert.equal(images.at(-1), '/api/screenshot?run=current&tabId=tab_1&sequence=2');
  assert.equal(ui.get('screen').style.display, 'block');
  assert.equal(ui.get('view-kind').textContent, 'Saved screenshot · live view ended');
});

await check('live pixels and time disappear before a saved screenshot body arrives', async () => {
  const body = Promise.withResolvers();
  const requested = Promise.withResolvers();
  let run = pendingApproval;
  const images = [];
  const approvals = [];
  const ui = dashboard(async (path, options) => {
    if (path === '/api/state') {
      return json({ liveAvailable: false, run });
    }
    if (path === '/api/approval') {
      approvals.push(JSON.parse(options.body));
      return json({});
    }
    images.push(path);
    if (path.startsWith('/api/screenshot?')) {
      return {
        ok: true,
        blob() {
          requested.resolve();
          return body.promise;
        },
      };
    }
    return new Response('live bytes');
  });
  await ui.ready;
  assert.equal(ui.get('screen').style.display, 'block');
  const liveSrc = ui.get('screen').src;
  run = {
    ...common,
    id: 'current',
    status: 'complete',
    owner: 'stopped',
    result: 'verified',
    view: { status: 'closed', sequence: 5 },
    screenshotAt: 123,
  };
  const polling = ui.poll();
  await requested.promise;
  try {
    assert.equal(
      ui.get('screen').style.display,
      'none',
      'old live pixels must be cleared before body settles',
    );
    assert.equal(ui.get('screen').src, undefined);
    assert.equal(ui.get('snapshot-time').textContent, '');
    assert.equal(ui.get('view-kind').textContent, 'Loading saved screenshot…');
    assert.equal(
      ui.get('approval').hidden,
      true,
      'completed state must remove approval before pixels arrive',
    );
    assert.equal(ui.get('approval-text').textContent, '');
    await ui.clickApprove();
    assert.deepEqual(approvals, [], 'a pre-image completed state must not submit the old approval');
  } finally {
    body.resolve(new Blob(['saved bytes']));
    await polling;
  }
  assert.equal(ui.get('screen').style.display, 'block');
  assert.notEqual(ui.get('screen').src, liveSrc);
  assert.equal(ui.get('view-kind').textContent, 'Saved screenshot · live view ended');
  assert.match(ui.get('snapshot-time').textContent, /^Captured /u);
  await ui.poll();
  assert.deepEqual(images, [
    '/api/view?run=current&tabId=tab_1&sequence=2',
    '/api/screenshot?run=current&tabId=tab_1&sequence=2',
  ]);
  assert.equal(ui.get('view-kind').textContent, 'Saved screenshot · live view ended');
});

await check('ending with no saved checkpoint clears live pixels and never claims a capture', async () => {
  let run = pendingApproval;
  const images = [];
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      return json({ liveAvailable: false, run });
    }
    images.push(path);
    return new Response('live bytes');
  });
  await ui.ready;
  assert.equal(ui.get('screen').style.display, 'block');
  run = {
    ...common,
    id: 'current',
    status: 'stopped',
    owner: 'stopped',
    view: { status: 'closed', sequence: 5 },
  };
  await ui.poll();
  assert.equal(ui.get('screen').style.display, 'none');
  assert.equal(ui.get('screen').src, undefined);
  assert.equal(ui.get('snapshot-time').textContent, '');
  assert.equal(ui.get('view-kind').textContent, 'Saved screenshot unavailable');
  await ui.poll();
  assert.deepEqual(images, ['/api/view?run=current&tabId=tab_1&sequence=2']);
  assert.equal(ui.get('view-kind').textContent, 'Saved screenshot unavailable');
  assert.equal(ui.get('snapshot-time').textContent, '');
});

await check('a failing old state poll after Start settlement cannot disconnect the display', async () => {
  const start = Promise.withResolvers();
  const state = Promise.withResolvers();
  let stateCalls = 0;
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      stateCalls += 1;
      if (stateCalls === 1) {
        return json({ liveAvailable: false, run: null });
      }
      return stateCalls === 2
        ? state.promise
        : json({ liveAvailable: false, run: { ...pendingApproval, id: 'new' } });
    }
    if (path === '/api/start') {
      return start.promise;
    }
    return new Response('image bytes');
  });
  await ui.ready;
  await ui.render({
    ...common,
    id: 'old',
    status: 'complete',
    owner: 'stopped',
    screenshotAt: 123,
    view: { status: 'closed', sequence: 5 },
  });
  const starting = ui.clickStart();
  const polling = ui.poll();
  start.resolve(json({ ...pendingApproval, id: 'new' }));
  await starting;
  state.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }));
  await polling;
  assert.equal(ui.get('status').textContent, 'Verified');
  assert.equal(ui.get('start').disabled, true);
  assert.equal(ui.get('message').textContent, '');
  await ui.poll();
  assert.equal(ui.get('status').textContent, 'running');
  assert.equal(ui.get('screen').style.display, 'block');
  assert.equal(ui.get('view-kind').textContent, 'Live browser view · view only');
  assert.equal(ui.get('approval').hidden, false);
});

await check(
  'serial state polls report disconnect and recovery while the original Start POST stays pending',
  async () => {
    const start = Promise.withResolvers();
    const submitted = [];
    let failure = false;
    let run = {
      ...common,
      id: 'old',
      status: 'complete',
      owner: 'stopped',
      screenshotAt: 123,
      view: { status: 'closed' },
    };
    const ui = dashboard(async (path, options) => {
      if (path === '/api/state') {
        return failure
          ? Response.json({ error: 'Unavailable' }, { status: 503 })
          : json({ liveAvailable: false, run });
      }
      if (path === '/api/start') {
        submitted.push({ body: JSON.parse(options.body), signal: options.signal });
        return start.promise;
      }
      return new Response('image bytes');
    });
    await ui.ready;
    ui.get('api').value = 'responses';
    ui.get('mode').value = 'live';
    const starting = ui.clickStart();
    try {
      failure = true;
      // Each poll finishes before another begins, just as the real timer loop does.
      await ui.poll();
      assert.equal(ui.get('status').textContent, 'Connection lost');
      assert.equal(ui.get('screen').style.display, 'none');
      assert.equal(ui.get('start').disabled, true);
      failure = false;
      run = {
        ...common,
        id: 'different',
        status: 'complete',
        owner: 'stopped',
        screenshotAt: 234,
        view: { status: 'closed' },
      };
      await ui.poll();
      assert.equal(ui.get('status').textContent, 'Verified');
      assert.equal(ui.get('screen').style.display, 'block');
      assert.equal(ui.get('view-kind').textContent, 'Saved screenshot · live view ended');
      assert.equal(ui.get('start').disabled, true, 'recovery must not admit a duplicate Start POST');
      assert.equal(ui.get('stop').disabled, true);
      assert.equal(ui.get('api').disabled, true);
      assert.equal(ui.get('mode').disabled, true);
      assert.equal(
        ui.get('api').value,
        'responses',
        'fresh state cannot overwrite the pending Start selection',
      );
      assert.equal(ui.get('mode').value, 'live');
      run = null;
      await ui.poll();
      assert.equal(ui.get('status').textContent, 'Ready');
      assert.equal(ui.get('start').disabled, true, 'valid idle still cannot admit a duplicate Start POST');
      assert.equal(ui.get('api').disabled, true);
      assert.equal(ui.get('mode').disabled, true);
      assert.deepEqual(submitted, [
        {
          body: { taskId: 'support', environment: 'browser', api: 'responses', mode: 'live' },
          signal: undefined,
        },
      ]);
    } finally {
      start.resolve(json({ ...pendingApproval, id: 'accepted', api: 'responses', mode: 'live' }));
      await starting;
    }
    assert.equal(ui.get('status').textContent, 'Ready');
    assert.equal(ui.get('start').disabled, true);
    run = { ...pendingApproval, id: 'accepted', api: 'responses', mode: 'live' };
    await ui.poll();
    assert.equal(ui.get('status').textContent, 'running');
    assert.equal(ui.get('view-kind').textContent, 'Live browser view · view only');
    assert.equal(ui.get('start').disabled, true);
  },
);

await Promise.all(
  ['accepted', 'another-dashboard'].map((observedId) =>
    check(`a delayed Start acknowledgement cannot regress completed state for ${observedId}`, async () => {
      const start = Promise.withResolvers();
      let run = null;
      const ui = dashboard(async (path) => {
        if (path === '/api/state') {
          return json({ liveAvailable: false, run });
        }
        if (path === '/api/start') {
          return start.promise;
        }
        return new Response('image bytes');
      });
      await ui.ready;
      ui.get('api').value = 'responses';
      ui.get('mode').value = 'live';
      const starting = ui.clickStart();
      run = {
        ...common,
        id: observedId,
        status: 'complete',
        owner: 'stopped',
        result: 'verified',
        view: { status: 'closed', sequence: 5 },
        screenshotAt: 123,
      };
      await ui.poll();
      const savedSrc = ui.get('screen').src;
      assert.equal(ui.get('status').textContent, 'Verified');
      assert.equal(ui.get('view-kind').textContent, 'Saved screenshot · live view ended');
      start.resolve(
        json({
          ...common,
          id: 'accepted',
          status: 'running',
          view: { status: 'starting', sequence: 0 },
        }),
      );
      await starting;
      assert.equal(ui.get('status').textContent, 'Verified');
      assert.equal(ui.get('screen').src, savedSrc);
      assert.equal(ui.get('view-kind').textContent, 'Saved screenshot · live view ended');
      assert.equal(ui.get('start').disabled, true, 'only the next valid state poll may unlock Start');
      assert.equal(ui.get('api').disabled, true);
      assert.equal(ui.get('mode').disabled, true);
      await ui.poll();
      assert.equal(ui.get('start').disabled, false);
      assert.equal(ui.get('stop').disabled, true);
      assert.equal(ui.get('api').disabled, false);
      assert.equal(ui.get('mode').disabled, false);
    }),
  ),
);

await Promise.all(
  ['running', 'disconnected'].map((observed) =>
    check(`a rejected Start cannot unlock controls after a newer ${observed} state`, async () => {
      const start = Promise.withResolvers();
      let run = null;
      let failure = false;
      const ui = dashboard(async (path) => {
        if (path === '/api/state') {
          return failure
            ? Response.json({ error: 'Unavailable' }, { status: 503 })
            : json({ liveAvailable: false, run });
        }
        if (path === '/api/start') {
          return start.promise;
        }
        return new Response('image bytes');
      });
      await ui.ready;
      const starting = ui.clickStart();
      assert.equal(ui.get('start').disabled, true);
      run = pendingApproval;
      failure = observed === 'disconnected';
      await ui.poll();
      const status = observed === 'running' ? 'running' : 'Connection lost';
      assert.equal(ui.get('status').textContent, status);
      assert.equal(ui.get('start').disabled, true);
      start.resolve(Response.json({ error: 'Start was not accepted.' }, { status: 409 }));
      await starting;
      assert.equal(ui.get('status').textContent, status);
      assert.equal(ui.get('start').disabled, true, 'POST failure is not permission to begin another run');
      assert.equal(ui.get('stop').disabled, true);
      assert.equal(ui.get('api').disabled, true);
      assert.equal(ui.get('mode').disabled, true);
      failure = false;
      await ui.poll();
      assert.equal(ui.get('status').textContent, 'running');
      assert.equal(ui.get('start').disabled, true);
      assert.equal(ui.get('stop').disabled, false);
    }),
  ),
);

await check('a valid no-run state restores idle controls and clears old approvals', async () => {
  let run = pendingApproval;
  let stateFails = false;
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      return stateFails ? new Response('', { status: 503 }) : json({ liveAvailable: false, run });
    }
    return new Response('image bytes');
  });
  await ui.ready;
  stateFails = true;
  await ui.poll();
  run = null;
  stateFails = false;
  await ui.poll();
  assert.equal(ui.get('screen').style.display, 'none');
  assert.equal(ui.get('start').disabled, false);
  assert.equal(ui.get('stop').disabled, true);
  assert.equal(ui.get('approval').hidden, true);
  assert.equal(ui.get('status').textContent, 'Ready');
});

await Promise.all(
  ['state', 'view'].map((resource) =>
    check(`a slow ${resource} GET body times out before the next serial poll recovers`, async () => {
      let slow = false;
      let run = pendingApproval;
      let aborted = false;
      const images = [];
      const ui = dashboard(async (path, options) => {
        if (path.startsWith('/api/view?')) {
          images.push(path);
        }
        if (slow && path.startsWith(`/api/${resource}`)) {
          const body = path === '/api/state' ? JSON.stringify({ liveAvailable: false, run }) : 'slow pixels';
          return new Response(
            new ReadableStream({
              start(controller) {
                const timer = setTimeout(() => {
                  controller.enqueue(new TextEncoder().encode(body));
                  controller.close();
                }, 6000);
                options.signal?.addEventListener(
                  'abort',
                  () => {
                    aborted = true;
                    clearTimeout(timer);
                    controller.error(options.signal.reason);
                  },
                  { once: true },
                );
              },
            }),
          );
        }
        return path === '/api/state' ? json({ liveAvailable: false, run }) : new Response('image bytes');
      });
      await ui.ready;
      assert.equal(ui.get('screen').style.display, 'block');
      run = { ...pendingApproval, view: { ...pendingApproval.view, sequence: 6 } };
      slow = true;
      // The production poll awaits the complete body; do not call another poll until it settles.
      await ui.poll();
      assert.equal(aborted, true, 'the five-second GET deadline must also cover body consumption');
      assert.equal(ui.get('screen').style.display, 'none');
      if (resource === 'state') {
        assert.equal(ui.get('status').textContent, 'Connection lost');
        assert.equal(ui.get('approval').hidden, true);
      } else {
        assert.equal(ui.get('status').textContent, 'running');
        assert.equal(ui.get('view-kind').textContent, 'Browser view unavailable');
      }
      const beforeRecovery = images.length;
      slow = false;
      await ui.poll();
      assert.equal(images.length, beforeRecovery + 1);
      assert.equal(ui.get('screen').style.display, 'block');
      assert.equal(ui.get('view-kind').textContent, 'Live browser view · view only');
      assert.equal(ui.get('approval').hidden, false);
    }),
  ),
);

await check('ownership controls follow fresh states; Stop stays available through both drains', async () => {
  let run = pendingApproval;
  const ui = dashboard(async (path) =>
    path === '/api/state' ? json({ liveAvailable: false, run }) : new Response('image bytes'),
  );
  await ui.ready;
  assert.equal(ui.get('take-control').disabled, false);
  assert.equal(ui.get('return-control').disabled, true);
  assert.equal(ui.get('human-controls').disabled, true);
  assert.equal(ui.get('approval').hidden, false);
  run = { ...run, owner: 'draining-to-human', ownerVersion: 1 };
  await ui.poll();
  assert.equal(ui.get('owner-status').textContent, 'Waiting for the agent to finish');
  assert.equal(ui.get('human-controls').disabled, true);
  assert.equal(ui.get('take-control').disabled, true);
  assert.equal(ui.get('return-control').disabled, true);
  assert.equal(ui.get('approval').hidden, true);
  assert.equal(ui.get('stop').disabled, false);
  run = { ...run, status: 'stopped', owner: 'human', ownerVersion: 2, approval: null };
  await ui.poll();
  assert.equal(ui.get('owner-status').textContent, 'You control the browser');
  assert.equal(ui.get('human-controls').disabled, false);
  assert.equal(ui.get('start').disabled, true, 'the session remains open even if the old agent loop stopped');
  assert.equal(ui.get('api').disabled, true);
  assert.equal(ui.get('mode').disabled, true);
  assert.equal(ui.get('stop').disabled, false);
  assert.equal(ui.get('view-kind').textContent, 'Live browser view · click to interact');
  run = { ...run, owner: 'draining-to-agent', ownerVersion: 3 };
  await ui.poll();
  assert.equal(ui.get('owner-status').textContent, 'Finishing your input before returning');
  assert.equal(ui.get('human-controls').disabled, true);
  assert.equal(ui.get('stop').disabled, false);
  run = {
    ...run,
    status: 'complete',
    owner: 'stopped',
    ownerVersion: 4,
    closing: true,
    view: { status: 'closed' },
  };
  await ui.poll();
  assert.equal(ui.get('start').disabled, true, 'closure still has to drain');
  assert.equal(ui.get('api').disabled, true);
  assert.equal(ui.get('mode').disabled, true);
  assert.equal(ui.get('stop').disabled, true);
  run = { ...run, closing: false };
  await ui.poll();
  assert.equal(ui.get('start').disabled, false);
  assert.equal(ui.get('stop').disabled, true);
  assert.equal(ui.get('human-controls').disabled, true);
});

await check('a new human phase needs fresh pixels even at an unchanged frame sequence', async () => {
  const frame = Promise.withResolvers();
  const requested = Promise.withResolvers();
  let run = pendingApproval;
  let waitingForFrame = false;
  const posts = [];
  const ui = dashboard(async (path, options) => {
    if (path === '/api/state') {
      return json({ liveAvailable: false, run });
    }
    if (options.method === 'POST') {
      posts.push({ path, body: JSON.parse(options.body) });
      return json({});
    }
    if (waitingForFrame) {
      return {
        ok: true,
        blob() {
          requested.resolve();
          return frame.promise;
        },
      };
    }
    return new Response('initial pixels');
  });
  await ui.ready;
  run = { ...pendingApproval, owner: 'human', ownerVersion: 2, approval: null };
  waitingForFrame = true;
  const polling = ui.poll();
  // If the unchanged frame was incorrectly cached, wait no longer than this poll.
  await Promise.race([requested.promise, polling]);
  try {
    assert.equal(ui.get('human-controls').disabled, true);
    assert.equal(ui.get('screen').style.display, 'none');
    await ui.click('screen', { clientX: 296, clientY: 260 });
    assert.deepEqual(posts, []);
  } finally {
    frame.resolve(new Blob(['current human pixels']));
    await polling;
  }
  assert.equal(ui.get('human-controls').disabled, false);
  await ui.click('screen', { clientX: 296, clientY: 260 });
  assert.deepEqual(posts, [
    {
      path: '/api/input',
      body: {
        runId: 'current',
        ownerVersion: 2,
        tabId: 'tab_1',
        sequence: 2,
        action: 'click',
        x: 512,
        y: 360,
      },
    },
  ]);
  assert.equal(ui.get('human-controls').disabled, true, 'ACK never unlocks human controls');
  await ui.poll();
  assert.equal(ui.get('human-controls').disabled, false);
});

await check(
  'human input remains disabled when pixels, connection or input availability are lost',
  async () => {
    let run = { ...pendingApproval, owner: 'human', ownerVersion: 2, approval: null };
    let failure = '';
    const posts = [];
    const ui = dashboard(async (path, options) => {
      if (path === '/api/state') {
        return failure === 'state'
          ? Response.json({ error: 'Unavailable' }, { status: 503 })
          : json({ liveAvailable: false, run });
      }
      if (options.method === 'POST') {
        posts.push(path);
        return json({});
      }
      return failure === 'image' ? new Response('', { status: 410 }) : new Response('image bytes');
    });
    await ui.ready;
    assert.equal(ui.get('human-controls').disabled, false);
    run = { ...run, humanInputBusy: true };
    await ui.poll();
    await ui.click('screen', { clientX: 296, clientY: 260 });
    assert.equal(ui.get('human-controls').disabled, true);
    run = { ...run, humanInputBusy: false, view: { ...run.view, sequence: 6 } };
    failure = 'image';
    await ui.poll();
    await ui.click('screen', { clientX: 296, clientY: 260 });
    assert.equal(ui.get('human-controls').disabled, true);
    assert.equal(ui.get('view-kind').textContent, 'Browser view unavailable');
    failure = 'state';
    await ui.poll();
    await ui.click('screen', { clientX: 296, clientY: 260 });
    assert.equal(ui.get('human-controls').disabled, true);
    assert.equal(ui.get('owner-status').textContent, 'Connection lost');
    assert.deepEqual(posts, []);
    failure = '';
    await ui.poll();
    assert.equal(ui.get('human-controls').disabled, false);
  },
);

await check(
  'bounded human text, key and scroll capture current phase, never send off-image clicks',
  async () => {
    let run = { ...pendingApproval, owner: 'human', ownerVersion: 8, approval: null };
    const posts = [];
    const ui = dashboard(async (path, options) => {
      if (path === '/api/state') {
        return json({ liveAvailable: false, run });
      }
      if (options.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body), signal: options.signal });
        return json({});
      }
      return new Response('image bytes');
    });
    await ui.ready;
    await ui.click('screen', { clientX: 10, clientY: 260 });
    await ui.click('screen', { clientX: 552, clientY: 260 });
    assert.deepEqual(posts, []);
    ui.get('human-text').value = 'Ada';
    await ui.click('send-text');
    await ui.poll();
    ui.get('human-key').value = 'Enter';
    await ui.click('send-key');
    await ui.poll();
    ui.get('scroll-direction').value = 'down';
    ui.get('scroll-amount').value = '640';
    await ui.click('send-scroll');
    assert.deepEqual(posts, [
      {
        path: '/api/input',
        body: { runId: 'current', ownerVersion: 8, tabId: 'tab_1', sequence: 2, action: 'type', text: 'Ada' },
        signal: undefined,
      },
      {
        path: '/api/input',
        body: { runId: 'current', ownerVersion: 8, tabId: 'tab_1', sequence: 2, action: 'key', key: 'Enter' },
        signal: undefined,
      },
      {
        path: '/api/input',
        body: {
          runId: 'current',
          ownerVersion: 8,
          tabId: 'tab_1',
          sequence: 2,
          action: 'scroll',
          direction: 'down',
          amount: 640,
        },
        signal: undefined,
      },
    ]);
    run = { ...run, ownerVersion: 10 };
    await ui.poll();
    ui.get('human-text').value = 'x'.repeat(2001);
    await ui.click('send-text');
    assert.equal(posts.length, 3);
  },
);

await check(
  'late handoff POSTs never restore an old phase, clear new state or allow duplicate POSTs',
  async () => {
    const take = Promise.withResolvers();
    let run = pendingApproval;
    const posts = [];
    const ui = dashboard(async (path, options) => {
      if (path === '/api/state') {
        return json({ liveAvailable: false, run });
      }
      if (options.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body) });
        return path === '/api/take-control' ? take.promise : json({});
      }
      return new Response('image bytes');
    });
    await ui.ready;
    const taking = ui.click('take-control');
    try {
      assert.equal(ui.get('take-control').disabled, true);
      assert.equal(ui.get('approval').hidden, true);
      await ui.click('take-control');
      run = { ...pendingApproval, owner: 'human', ownerVersion: 2, approval: null };
      await ui.poll();
      assert.equal(ui.get('owner-status').textContent, 'You control the browser');
      assert.equal(ui.get('human-controls').disabled, true, 'wait for original POST settlement');
    } finally {
      take.resolve(Response.json({ error: 'old take response' }, { status: 409 }));
      await taking;
    }
    assert.equal(ui.get('owner-status').textContent, 'You control the browser');
    assert.equal(ui.get('message').textContent, '');
    assert.equal(ui.get('human-controls').disabled, true);
    await ui.poll();
    assert.equal(ui.get('human-controls').disabled, false);
    await ui.click('return-control');
    assert.equal(ui.get('human-controls').disabled, true);
    assert.deepEqual(posts, [
      { path: '/api/take-control', body: { runId: 'current', ownerVersion: 0, tabId: 'tab_1', sequence: 2 } },
      {
        path: '/api/return-control',
        body: { runId: 'current', ownerVersion: 2, tabId: 'tab_1', sequence: 2 },
      },
    ]);
  },
);

const savedHistory = {
  dropped: 3,
  checkpoints: [
    { sequence: 4, at: 123, atMs: 11, owner: 'agent' },
    { sequence: 5, at: 123, atMs: 12, owner: 'agent' },
  ],
};
await Promise.all(
  [
    { owner: 'agent', approval: pendingApproval.approval, name: 'agent' },
    { owner: 'human', approval: null, name: 'ordinary human' },
    { owner: 'human', approval: pendingApproval.approval, name: 'human inspector' },
  ].map(({ owner, approval, name }) =>
    check(`saved view locks ${name} controls immediately and requires a fresh current frame`, async () => {
      const posts = [];
      const images = [];
      const requested = Promise.withResolvers();
      const frame = Promise.withResolvers();
      let waitForLive = false;
      const run = { ...pendingApproval, owner, approval, history: savedHistory };
      const ui = dashboard(async (path, options) => {
        if (path === '/api/state') {
          return json({ run });
        }
        if (options.method === 'POST') {
          posts.push(path);
          return json({});
        }
        images.push(path);
        if (waitForLive && path.startsWith('/api/view')) {
          return {
            ok: true,
            blob() {
              requested.resolve();
              return frame.promise;
            },
          };
        }
        return new Response(path);
      });
      await ui.ready;
      const liveURL = ui.get('screen').src;
      assert.match(ui.get('history-note').textContent, /3/u);
      assert.equal(ui.get('stop').disabled, false);
      ui.selectCheckpoint('4');
      assert.equal(ui.get('screen').style.display, 'none', 'selection clears old live pixels synchronously');
      assert.equal(ui.get('approval').hidden, true);
      assert.equal(ui.get('human-controls').disabled, true);
      assert.equal(ui.get('take-control').disabled, true);
      await ui.clickApprove();
      await ui.click('take-control');
      await ui.click('return-control');
      await ui.click('screen', { clientX: 296, clientY: 260 });
      await ui.poll();
      assert.match(ui.get('view-kind').textContent, /Saved checkpoint 4.*view only/u);
      assert.match(ui.get('snapshot-time').textContent, /Captured/u);
      assert.notEqual(ui.get('screen').src, liveURL);
      assert.equal(ui.get('stop').disabled, false);
      ui.get('human-text').value = 'must not type';
      await ui.click('send-text');
      await ui.clickApprove();
      assert.deepEqual(posts, []);
      assert.deepEqual(images, [
        '/api/view?run=current&tabId=tab_1&sequence=2',
        '/api/checkpoint?run=current&checkpoint=4',
      ]);
      await ui.click('return-current');
      assert.equal(ui.get('screen').style.display, 'none');
      assert.equal(ui.get('approval').hidden, true);
      assert.equal(ui.get('human-controls').disabled, true);
      waitForLive = true;
      const polling = ui.poll();
      await Promise.race([requested.promise, polling]);
      try {
        assert.equal(
          ui.get('approval').hidden,
          true,
          'fresh state alone cannot approve against saved pixels',
        );
        assert.equal(ui.get('human-controls').disabled, true);
        await ui.clickApprove();
        assert.deepEqual(posts, []);
      } finally {
        frame.resolve(new Blob(['fresh current pixels']));
        await polling;
      }
      assert.equal(
        images.at(-1),
        '/api/view?run=current&tabId=tab_1&sequence=2',
        'refetch even if the live sequence is unchanged',
      );
      assert.equal(ui.get('human-controls').disabled, owner !== 'human');
      assert.equal(ui.get('approval').hidden, approval === null);
      if (approval) {
        await ui.clickApprove();
        assert.deepEqual(posts, ['/api/approval']);
      }
    }),
  ),
);

await check('a delayed saved body cannot reappear after return to current view', async () => {
  const held = Promise.withResolvers();
  const requested = Promise.withResolvers();
  const images = [];
  const run = { ...pendingApproval, history: savedHistory };
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      return json({ run });
    }
    images.push(path);
    if (path.startsWith('/api/checkpoint')) {
      return {
        ok: true,
        blob() {
          requested.resolve();
          return held.promise;
        },
      };
    }
    return new Response('current');
  });
  await ui.ready;
  ui.selectCheckpoint('4');
  const polling = ui.poll();
  await Promise.race([requested.promise, polling]);
  try {
    await ui.click('return-current');
    assert.equal(ui.get('screen').style.display, 'none');
    assert.equal(ui.get('approval').hidden, true);
  } finally {
    held.resolve(new Blob(['old saved body']));
    await polling;
  }
  assert.equal(ui.get('screen').style.display, 'none', 'old GET must settle before the next serial poll');
  assert.equal(ui.get('approval').hidden, true);
  await ui.poll();
  assert.match(ui.get('view-kind').textContent, /Live browser/u);
  assert.equal(ui.get('approval').hidden, false);
  assert.deepEqual(images, [
    '/api/view?run=current&tabId=tab_1&sequence=2',
    '/api/checkpoint?run=current&checkpoint=4',
    '/api/view?run=current&tabId=tab_1&sequence=2',
  ]);
});

await check('an evicted or unavailable checkpoint never falls back to a live/latest image', async () => {
  const images = [];
  let missing = false;
  let run = { ...pendingApproval, history: savedHistory };
  const ui = dashboard(async (path) => {
    if (path === '/api/state') {
      return json({ run });
    }
    images.push(path);
    return missing && path.startsWith('/api/checkpoint')
      ? new Response('', { status: 404 })
      : new Response(path);
  });
  await ui.ready;
  ui.selectCheckpoint('4');
  missing = true;
  await ui.poll();
  assert.match(ui.get('view-kind').textContent, /Checkpoint unavailable/u);
  assert.equal(ui.get('screen').style.display, 'none');
  assert.equal(ui.get('approval').hidden, true);
  assert.equal(ui.get('take-control').disabled, true);
  missing = false;
  await ui.poll();
  assert.match(ui.get('view-kind').textContent, /Saved checkpoint 4/u);
  run = { ...run, history: { dropped: 4, checkpoints: savedHistory.checkpoints.slice(1) } };
  await ui.poll();
  assert.equal(ui.get('screen').style.display, 'none', 'remove already displayed pixels after eviction');
  assert.match(ui.get('view-kind').textContent, /Checkpoint unavailable/u);
  assert.match(ui.get('history-note').textContent, /4/u);
  assert.equal(images.filter((path) => !path.startsWith('/api/checkpoint')).length, 1);
});

await check(
  'run and owner changes leave saved view even when timestamp and checkpoint IDs match',
  async () => {
    const images = [];
    let run = { ...pendingApproval, history: savedHistory };
    const ui = dashboard(async (path) => {
      if (path === '/api/state') {
        return json({ run });
      }
      images.push(path);
      return new Response(path);
    });
    await ui.ready;
    ui.selectCheckpoint('4');
    await ui.poll();
    ui.selectCheckpoint('5');
    assert.equal(ui.get('screen').style.display, 'none');
    await ui.poll();
    assert.match(ui.get('view-kind').textContent, /Saved checkpoint 5/u);
    assert.equal(images.at(-1), '/api/checkpoint?run=current&checkpoint=5');
    run = { ...run, owner: 'human', ownerVersion: 2, approval: null };
    await ui.poll();
    assert.equal(ui.get('checkpoint').value, '');
    assert.match(ui.get('view-kind').textContent, /click to interact/u);
    assert.equal(ui.get('human-controls').disabled, false);
    ui.selectCheckpoint('5');
    await ui.poll();
    run = { ...run, id: 'replacement' };
    await ui.poll();
    assert.equal(ui.get('checkpoint').value, '');
    assert.equal(images.at(-1), '/api/view?run=replacement&tabId=tab_1&sequence=2');
    assert.match(ui.get('view-kind').textContent, /click to interact/u);
  },
);

await check(
  'Take before first tab exists sends only the current null binding; Return and inputs stay locked',
  async () => {
    const posts = [];
    const run = {
      ...common,
      id: 'setup',
      browser: null,
      screenshotBinding: null,
      view: { status: 'starting' },
    };
    const ui = dashboard(async (path, options) => {
      if (path === '/api/state') {
        return json({ run });
      }
      posts.push({ path, body: JSON.parse(options.body) });
      return json({});
    });
    await ui.ready;
    assert.equal(ui.get('take-control').disabled, false);
    assert.equal(ui.get('return-control').disabled, true);
    await ui.click('send-key');
    await ui.click('take-control');
    assert.deepEqual(posts, [
      {
        path: '/api/take-control',
        body: {
          runId: 'setup',
          ownerVersion: 0,
          tabId: null,
          sequence: null,
        },
      },
    ]);
  },
);

await check(
  'tab selection revokes live pixels at admission, binds POST, and unlocks only after the fresh Notes frame',
  async () => {
    let run = { ...pendingApproval, owner: 'human', ownerVersion: 2, approval: null };
    const posts = [];
    const ack = Promise.withResolvers();
    const notesFrame = Promise.withResolvers();
    const requested = Promise.withResolvers();
    const ui = dashboard(async (path, options) => {
      if (path === '/api/state') {
        return json({ run });
      }
      if (options?.method === 'POST') {
        posts.push({ path, body: JSON.parse(options.body) });
        return ack.promise;
      }
      if (path.includes('tabId=tab_2')) {
        requested.resolve();
        return { ok: true, blob: () => notesFrame.promise };
      }
      return new Response('Task');
    });
    await ui.ready;
    const opening = ui.click('open-notes');
    assert.equal(ui.get('screen').style.display, 'none');
    assert.equal(ui.get('human-controls').disabled, true);
    assert.equal(ui.get('stop').disabled, false);
    await ui.click('screen', { clientX: 220, clientY: 170 });
    assert.deepEqual(posts, [
      {
        path: '/api/input',
        body: {
          runId: 'current',
          ownerVersion: 2,
          tabId: 'tab_1',
          sequence: 2,
          action: 'open_notes',
        },
      },
    ]);
    ack.resolve(json({}));
    await opening;
    run = {
      ...run,
      browser: {
        tabId: 'tab_2',
        sequence: 4,
        role: 'Notes',
        tabs: [
          { id: 'tab_1', role: 'Task' },
          { id: 'tab_2', role: 'Notes' },
        ],
      },
    };
    const polling = ui.poll();
    await requested.promise;
    assert.equal(ui.get('open-notes').disabled, true);
    assert.equal(ui.get('browser-tab').disabled, true);
    await ui.click('send-key');
    assert.equal(posts.length, 1);
    notesFrame.resolve(new Blob(['Notes']));
    await polling;
    assert.equal(ui.get('human-controls').disabled, false);
    assert.equal(ui.get('browser-tab').value, 'tab_2');
    assert.equal(ui.get('close-notes').disabled, false);
    assert.equal(ui.get('open-notes').disabled, true);
    assert.match(ui.get('address').textContent, /Notes/u);
    await ui.selectTab('tab_1');
    assert.deepEqual(posts[1], {
      path: '/api/input',
      body: {
        runId: 'current',
        ownerVersion: 2,
        tabId: 'tab_2',
        sequence: 4,
        action: 'switch_tab',
        tab_id: 'tab_1',
      },
    });
    assert.equal(ui.get('screen').style.display, 'none');
  },
);

await check(
  'an old same-run frame cannot reappear after a newer tab, even if the frame sequence repeats',
  async () => {
    const oldFrame = Promise.withResolvers();
    const received = Promise.withResolvers();
    let delaying = false;
    const ui = dashboard(async (path) => {
      if (path === '/api/state') {
        return json({ run: null });
      }
      if (delaying && path.includes('tabId=tab_1')) {
        received.resolve();
        return { ok: true, blob: () => oldFrame.promise };
      }
      return new Response(path);
    });
    await ui.ready;
    const human = { ...pendingApproval, owner: 'human', ownerVersion: 2, approval: null };
    delaying = true;
    const old = ui.render(human);
    await received.promise;
    await ui.render({
      ...human,
      browser: {
        tabId: 'tab_2',
        sequence: 5,
        role: 'Notes',
        tabs: [
          { id: 'tab_1', role: 'Task' },
          { id: 'tab_2', role: 'Notes' },
        ],
      },
    });
    const { src } = ui.get('screen');
    oldFrame.resolve(new Blob(['stale Task']));
    await old;
    assert.equal(ui.get('screen').src, src);
    assert.match(ui.get('address').textContent, /Notes/u);
    assert.equal(ui.get('human-controls').disabled, false);
  },
);

await check('workspace choice cannot reopen controls while Start is pending', async () => {
  const pending = Promise.withResolvers();
  const ui = dashboard(async (path) =>
    path === '/api/start'
      ? pending.promise
      : json({ liveAvailable: true, desktopAvailable: true, run: null }),
  );
  await ui.ready;
  ui.selectEnvironment('desktop');
  const starting = ui.clickStart();
  assert.equal(ui.get('environment').disabled, true);
  ui.selectEnvironment('browser');
  assert.equal(ui.get('start').disabled, true);
  assert.equal(ui.get('api').disabled, true);
  assert.equal(ui.get('mode').disabled, true);
  pending.resolve(json({}));
  await starting;
  assert.equal(ui.get('start').disabled, true, 'Only a fresh state can reopen Start.');
});

await check('workspace choice cannot reopen controls after state connection is lost', async () => {
  let lost = false;
  const ui = dashboard(async () => {
    if (lost) {
      throw new Error('Controlled connection loss');
    }
    return json({ liveAvailable: true, desktopAvailable: true, run: null });
  });
  await ui.ready;
  lost = true;
  await ui.poll();
  ui.selectEnvironment('desktop');
  assert.equal(ui.get('environment').disabled, true);
  assert.equal(ui.get('start').disabled, true);
  assert.equal(ui.get('api').disabled, true);
  assert.equal(ui.get('mode').disabled, true);
});

await check('Take control stays available while a same-owner frame is loading', async () => {
  const frame = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let held = false;
  const posts = [];
  const ui = dashboard(async (path, options) => {
    if (path === '/api/state') {
      return json({ run: null, liveAvailable: true });
    }
    if (path === '/api/take-control') {
      posts.push(JSON.parse(options.body));
      return json({ accepted: true });
    }
    if (held) {
      entered.resolve();
      return frame.promise;
    }
    return new Response('controlled image');
  });
  await ui.ready;
  const run = {
    ...common,
    id: 'frame-owner',
    status: 'running',
    view: { status: 'live', sequence: 1, at: Date.now() },
  };
  await ui.render(run);
  held = true;
  const painting = ui.render({ ...run, view: { ...run.view, sequence: 2 } });
  await entered.promise;
  try {
    assert.equal(ui.get('take-control').disabled, false);
    await ui.click('take-control');
    assert.deepEqual(posts, [{ runId: run.id, ownerVersion: 0, tabId: 'tab_1', sequence: 2 }]);
  } finally {
    frame.resolve(new Response('next controlled image'));
    await painting;
  }
});

for (const owner of ['agent', 'human']) {
  // Each owner has a different control surface, but the same current-frame boundary.
  // oxlint-disable-next-line no-await-in-loop
  await check(
    `${owner} controls stay usable during a same-owner frame and close on image failure`,
    async () => {
      const frame = Promise.withResolvers();
      const entered = Promise.withResolvers();
      let held = false;
      const ui = dashboard(async (path) => {
        if (path === '/api/state') {
          return json({ run: null, liveAvailable: true });
        }
        if (held) {
          entered.resolve();
          return frame.promise;
        }
        return new Response('controlled image');
      });
      await ui.ready;
      const run = {
        ...common,
        id: `keep-${owner}`,
        owner,
        status: 'running',
        approval: owner === 'agent' ? { id: 'approval-one', label: 'Controlled task' } : null,
        view: { status: 'live', sequence: 1, at: Date.now() },
      };
      await ui.render(run);
      held = true;
      const painting = ui.render({ ...run, view: { ...run.view, sequence: 2 } });
      await entered.promise;
      if (owner === 'human') {
        assert.equal(ui.get('human-controls').disabled, false);
        assert.equal(ui.get('return-control').disabled, false);
      } else {
        assert.equal(ui.get('approval').hidden, false);
      }
      frame.resolve(new Response('unavailable', { status: 503 }));
      await painting;
      assert.equal(ui.get('human-controls').disabled, true);
      assert.equal(ui.get('return-control').disabled, true);
      assert.equal(ui.get('approval').hidden, true);
    },
  );
}

if (failures.length) {
  console.error(`${failures.length} dashboard regression(s) failed against ${sourcePath}`);
  process.exitCode = 1;
} else {
  console.log('All script-level regression cases passed against', sourcePath);
}
