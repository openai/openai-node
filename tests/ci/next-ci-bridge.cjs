const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

const yaml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/next-ci.yml'), 'utf-8');
const scripts = [];
const lines = yaml.split('\n');
for (let index = 0; index < lines.length; index += 1) {
  if (lines[index] !== '          script: |') {
    continue;
  }
  let code = '';
  for (
    index += 1;
    index < lines.length && (lines[index].startsWith('            ') || !lines[index]);
    index += 1
  ) {
    code += `${lines[index].slice(12)}\n`;
  }
  scripts.push(code);
}
assert.equal(scripts.length, 2);
const AsyncFunction = Object.getPrototypeOf(async () => null).constructor;
const runScript = scripts.map((code) => new AsyncFunction('github', 'context', 'core', 'process', code));
const repository = 'openai/openai-node';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
function fixture(kind = 'pull_request') {
  const f = { writes: [], outputs: {}, base, head, queue: [head], prior: [], comparisonBase: base };
  f.pull = {
    number: 7,
    state: 'open',
    head: { sha: head, repo: { full_name: repository } },
    base: { ref: 'next', sha: base, repo: { full_name: repository } },
  };
  f.pulls = [f.pull];
  f.own = {
    repository: { full_name: repository },
    path: '.github/workflows/next-ci.yml',
    head_branch: 'main',
    event: 'workflow_run',
    run_attempt: 1,
  };
  f.source = {
    id: 20,
    repository: { full_name: repository },
    path: '.github/workflows/ci.yml',
    head_sha: head,
    head_repository: { full_name: repository },
    event: kind,
    status: 'completed',
    run_attempt: 1,
    head_branch: 'gh-readonly-queue/next/pr-7-test',
  };
  f.context = {
    repo: { owner: 'openai', repo: 'openai-node' },
    ref: 'refs/heads/main',
    runId: 50,
    eventName: 'workflow_run',
    payload: { workflow_run: { id: 20, head_sha: head, event: kind, run_attempt: 1 } },
  };
  f.env = { BRIDGE_ATTEMPT: '1', CODEQL_RESULT: 'success', DETECTOR_RESULT: 'success' };
  f.github = {
    rest: {
      repos: {
        get: async () => ({ data: { full_name: repository, default_branch: 'main' } }),
        listPullRequestsAssociatedWithCommit: () => {
          throw new Error('Use the paginated API');
        },
        listCommitStatusesForRef: () => {
          throw new Error('Use the paginated API');
        },
        compareCommitsWithBasehead: async () => ({
          data: { merge_base_commit: { sha: f.comparisonBase }, status: 'ahead' },
        }),
        createCommitStatus: async (x) => {
          f.writes.push(x);
        },
      },
      actions: { getWorkflowRun: async (x) => ({ data: x.run_id === 50 ? f.own : f.source }) },
      git: { getRef: async () => ({ data: { object: { sha: f.base } } }) },
      pulls: { get: async (x) => ({ data: f.pulls.find((p) => p.number === x.pull_number) }) },
    },
    graphql: async () => ({
      repository: {
        mergeQueue: {
          entries: {
            nodes: f.queue.map((oid) => ({ headCommit: { oid } })),
            pageInfo: { hasNextPage: false },
          },
        },
      },
    }),
    paginate: async (method) => {
      if (method === f.github.rest.repos.listCommitStatusesForRef) {
        f.duringPagination?.();
        return f.prior;
      }
      return f.pulls;
    },
  };
  f.execute = async (which) =>
    runScript[which](f.github, f.context, { setOutput: (k, v) => (f.outputs[k] = v) }, { env: f.env });
  f.authorize = async () => {
    await f.execute(0);
    if (f.outputs.receipt) {
      f.env.RECEIPT = f.outputs.receipt;
    }
  };
  return f;
}
const cases = [];
function test(name, action) {
  cases.push([name, action]);
}
function reject(name, mutate, which = 0, kind = 'pull_request') {
  test(name, async () => {
    const f = fixture(kind);
    if (which) {
      await f.authorize();
    }
    mutate(f);
    await assert.rejects(() => f.execute(which));
    assert.equal(f.writes.length, 0);
  });
}
test('current next PR produces three distinct real success contexts', async () => {
  const f = fixture();
  await f.authorize();
  await f.execute(1);
  assert.equal(f.writes.length, 3);
  assert(f.writes.every((s) => s.sha === head && s.state === 'success' && s.context.startsWith('Next CI /')));
});
test('same SHA main PR cannot consume next detector context', async () => {
  const f = fixture();
  f.pulls.push({ ...f.pull, number: 8, base: { ...f.pull.base, ref: 'main' } });
  await f.authorize();
  await f.execute(1);
  assert.deepEqual(
    f.writes.map((x) => x.context),
    [
      'Next CI / CodeQL (actions)',
      'Next CI / CodeQL (javascript-typescript)',
      'Next CI / detect-breaking-changes',
    ],
  );
});
test('manual dispatch resolves and checks immutable PR head', async () => {
  const f = fixture();
  f.context.eventName = 'workflow_dispatch';
  f.own.event = 'workflow_dispatch';
  f.context.payload = { inputs: { pull_number: '7' } };
  await f.authorize();
  assert.equal(JSON.parse(f.outputs.receipt).head, head);
});
test('fork candidate remains read-only and bound to authenticated fork head', async () => {
  const f = fixture();
  f.pull.head.repo.full_name = 'example/fork';
  f.source.head_repository.full_name = 'example/fork';
  await f.authorize();
  assert.equal(JSON.parse(f.outputs.receipt).head, head);
});
test('source run conclusion is never a passing result', async () => {
  const f = fixture();
  f.source.conclusion = 'success';
  await f.authorize();
  f.env.CODEQL_RESULT = 'failure';
  f.env.DETECTOR_RESULT = 'cancelled';
  await f.execute(1);
  assert(f.writes.every((s) => s.state === 'failure'));
});
test('missing trusted job results never pass', async () => {
  const f = fixture();
  await f.authorize();
  delete f.env.CODEQL_RESULT;
  delete f.env.DETECTOR_RESULT;
  await f.execute(1);
  assert(f.writes.every((s) => s.state === 'failure'));
});
test('matrix failure conservatively fails both CodeQL contexts', async () => {
  const f = fixture();
  await f.authorize();
  f.env.CODEQL_RESULT = 'failure';
  await f.execute(1);
  assert.deepEqual(
    f.writes.map((x) => x.state),
    ['failure', 'failure', 'success'],
  );
});
test('newer completed bridge result cannot be overwritten', async () => {
  const f = fixture();
  await f.authorize();
  f.prior = [
    {
      context: 'Next CI / detect-breaking-changes',
      creator: { login: 'github-actions[bot]' },
      description: '[next-ci:v1:51:1]',
      target_url: `https://github.com/${repository}/actions/runs/51`,
    },
  ];
  await f.execute(1);
  assert.equal(f.writes.length, 0);
});
test('same run newer attempt cannot be overwritten', async () => {
  const f = fixture();
  await f.authorize();
  f.prior = [
    {
      context: 'Next CI / CodeQL (actions)',
      creator: { login: 'github-actions[bot]' },
      description: '[next-ci:v1:50:2]',
      target_url: `https://github.com/${repository}/actions/runs/50`,
    },
  ];
  await f.execute(1);
  assert.equal(f.writes.length, 0);
});
test('other CI workflow is ignored instead of recursively evaluated', async () => {
  const f = fixture();
  f.source.path = '.github/workflows/detect-breaking-changes.yml';
  await f.authorize();
  assert.equal(f.outputs.receipt, undefined);
});
test('main source PR does not receive next contexts', async () => {
  const f = fixture();
  f.pull.base.ref = 'main';
  await f.authorize();
  assert.equal(f.outputs.receipt, undefined);
});
reject('manual main target rejected', (f) => {
  f.context.eventName = 'workflow_dispatch';
  f.own.event = 'workflow_dispatch';
  f.context.payload = { inputs: { pull_number: '7' } };
  f.pull.base.ref = 'main';
});
reject('manual arbitrary input rejected', (f) => {
  f.context.eventName = 'workflow_dispatch';
  f.own.event = 'workflow_dispatch';
  f.context.payload = { inputs: { pull_number: '7; echo token' } };
});
reject('foreign source run rejected', (f) => (f.source.repository.full_name = 'other/repository'));
reject('superseded source attempt rejected', (f) => (f.source.run_attempt = 2));
reject('running source run rejected', (f) => (f.source.status = 'in_progress'));
reject('source SHA mismatch rejected', (f) => (f.source.head_sha = 'c'.repeat(40)));
reject('malformed SHA rejected', (f) => {
  f.source.head_sha = 'main';
  f.context.payload.workflow_run.head_sha = 'main';
});
reject('foreign fork identity rejected', (f) => (f.source.head_repository.full_name = 'other/fork'));
reject('ambiguous next PR association rejected', (f) => f.pulls.push({ ...f.pull, number: 8 }));
reject('untrusted bridge branch rejected', (f) => (f.context.ref = 'refs/heads/next'));
reject('wrong bridge workflow rejected', (f) => (f.own.path = '.github/workflows/other.yml'));
reject('stale own attempt rejected', (f) => (f.own.run_attempt = 2));
reject('PR base stale at authorization rejected', (f) => (f.pull.base.sha = 'c'.repeat(40)));
reject('PR head movement prevents publication', (f) => (f.pull.head.sha = 'c'.repeat(40)), 1);
reject('next base movement prevents publication', (f) => (f.base = 'c'.repeat(40)), 1);
reject('retargeted main PR prevents publication', (f) => (f.pull.base.ref = 'main'), 1);
reject('closed PR prevents publication', (f) => (f.pull.state = 'closed'), 1);
reject(
  'tampered receipt repo rejected',
  (f) => (f.env.RECEIPT = JSON.stringify({ ...JSON.parse(f.env.RECEIPT), repository: 'other/repo' })),
  1,
);
test('current synthetic next queue SHA passes real jobs', async () => {
  const f = fixture('merge_group');
  await f.authorize();
  await f.execute(1);
  assert(f.writes.every((x) => x.sha === head && x.state === 'success'));
});
reject(
  'foreign queue source rejected',
  (f) => (f.source.head_repository.full_name = 'other/fork'),
  0,
  'merge_group',
);
reject('queue not current at authorization rejected', (f) => (f.queue = []), 0, 'merge_group');
reject('queue missing target base rejected', (f) => (f.comparisonBase = 'c'.repeat(40)), 0, 'merge_group');
reject('removed queue prevents publication', (f) => (f.queue = []), 1, 'merge_group');
reject('advanced next base prevents queue publication', (f) => (f.base = 'c'.repeat(40)), 1, 'merge_group');
for (const [name, mutate, kind] of [
  ['head moves', (f) => (f.pull.head.sha = 'c'.repeat(40)), 'pull_request'],
  ['base moves', (f) => (f.base = 'c'.repeat(40)), 'pull_request'],
  ['queue removed', (f) => (f.queue = []), 'merge_group'],
]) {
  test(`pagination race: ${name}`, async () => {
    const f = fixture(kind);
    await f.authorize();
    f.duringPagination = () => mutate(f);
    await assert.rejects(() => f.execute(1));
    assert.equal(f.writes.length, 0);
  });
}
test('main queue ignored', async () => {
  const f = fixture('merge_group');
  f.source.head_branch = 'gh-readonly-queue/main/pr-7-test';
  await f.authorize();
  assert.equal(f.outputs.receipt, undefined);
});
test('publication has no checkout, scripts or candidate outputs', async () => {
  const [before, publish] = yaml.split('\n  publish:\n');
  assert(publish.includes('next-ci-publish-'));
  assert(publish.includes('queue: max'));
  assert(publish.includes('cancel-in-progress: false'));
  assert(!publish.includes('checkout@'));
  assert(!publish.includes('run:'));
  assert(!publish.includes('download-artifact'));
  // oxlint-disable-next-line no-template-curly-in-string -- This is a literal GitHub Actions expression.
  assert(publish.includes('${{ needs.codeql.result }}'));
  // oxlint-disable-next-line no-template-curly-in-string -- This is a literal GitHub Actions expression.
  assert(publish.includes('${{ needs.detector.result }}'));
  assert(!before.includes('statuses: write'));
  assert(!yaml.includes('secrets: inherit'));
  assert(yaml.includes('permissions: {}'));
});
test('reusable analysis retains actual scan and detector steps', async () => {
  const codeql = fs.readFileSync(path.join(__dirname, '../../.github/workflows/codeql.yml'), 'utf-8');
  const detector = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/detect-breaking-changes.yml'),
    'utf-8',
  );
  for (const text of [codeql, detector]) {
    assert(text.includes('persist-credentials: false'));
    assert(!text.includes('statuses: write'));
    assert(!text.includes('pull-requests: write'));
    assert(text.includes('inputs.candidate_sha || github.sha'));
  }
  assert(codeql.includes('upload: never'));
  assert(codeql.includes('javascript-typescript'));
  assert(codeql.includes('finding_count} -ne 0'));
  assert(detector.includes('./scripts/detect-breaking-changes "$BASE_SHA"'));
  assert(detector.includes("inputs.candidate_sha == '' && 'pnpm' || ''"));
});
test('candidate execution cannot access runner cache authority', async () => {
  const detector = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/detect-breaking-changes.yml'),
    'utf-8',
  );
  const [, isolated] = detector.split(
    '      - name: Run unchanged candidate checks without runner credentials',
  );
  assert(isolated.includes('--read-only --cap-drop ALL --security-opt no-new-privileges'));
  assert(isolated.includes('--user "$(id -u):$(id -g)"'));
  assert(isolated.includes('target=/source,readonly'));
  assert.equal((isolated.match(/--mount/gu) || []).length, 1);
  assert(isolated.includes('--tmpfs /tmp:rw,exec,mode=1777'));
  assert(isolated.includes('cp -a /source/. /tmp/candidate/'));
  for (const forbidden of [
    '--env-file',
    'ACTIONS_RUNTIME',
    'ACTIONS_CACHE',
    'ACTIONS_RESULTS',
    'GITHUB_TOKEN',
    'docker.sock',
    '--privileged',
    '--pid',
    '--network host',
  ]) {
    assert(!isolated.includes(forbidden));
  }
  assert(isolated.includes('./scripts/bootstrap'));
  assert(isolated.includes('./scripts/detect-breaking-changes "$BASE_SHA"'));
  assert(/node:24-bookworm@sha256:[0-9a-f]{64}/u.test(isolated));
  for (const name of ['Set up pnpm', 'Set up Node', 'Install dependencies', 'Detect breaking changes']) {
    assert(detector.includes(`      - name: ${name}\n        if: inputs.candidate_sha == ''`));
  }
});
test('hosted validation invokes the same read-only candidate jobs', async () => {
  const validation = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/next-ci-validation.yml'),
    'utf-8',
  );
  assert(validation.includes('pull_request:'));
  assert(validation.includes('paths:'));
  assert(validation.includes('permissions: {}'));
  assert(!validation.includes(': write'));
  assert(!validation.includes('secrets:'));
  assert(!validation.includes('workflow_dispatch:'));
  assert(validation.includes('uses: ./.github/workflows/codeql.yml'));
  assert(validation.includes('uses: ./.github/workflows/detect-breaking-changes.yml'));
  assert(validation.includes('github.event.pull_request.head.sha'));
  assert(validation.includes('github.event.pull_request.base.sha'));
});
async function runCases() {
  try {
    await Promise.all(
      cases.map(async ([name, action]) => {
        await action();
        console.log(`PASS ${name}`);
      }),
    );
    console.log(`${cases.length} tests passed`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
runCases();
