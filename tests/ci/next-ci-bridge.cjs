const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

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
assert.equal(scripts.length, 3);
assert.equal(
  scripts[1],
  scripts[2],
  'Pending and result publishers must share exactly the same trust checks',
);
const AsyncFunction = Object.getPrototypeOf(async () => null).constructor;
const runScript = [scripts[0], scripts[2], scripts[1]].map(
  (code) => new AsyncFunction('github', 'context', 'core', 'process', code),
);
const repository = 'openai/openai-node';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const merge = 'd'.repeat(40);
const main = 'f'.repeat(40);
function fixture(kind = 'pull_request') {
  const f = {
    main,
    rules: [{ type: 'merge_queue' }],
    writes: [],
    outputs: {},
    base,
    head,
    queue: [head],
    prior: [],
    comparisonBase: base,
  };
  f.pull = {
    number: 7,
    state: 'open',
    merge_commit_sha: merge,
    mergeable: true,
    head: { sha: head, repo: { full_name: repository } },
    base: { ref: 'next', sha: base, repo: { full_name: repository } },
  };
  f.pulls = [f.pull];
  f.merge = { sha: merge, parents: [{ sha: base }, { sha: head }] };
  f.own = {
    repository: { full_name: repository },
    path: '.github/workflows/next-ci.yml',
    head_branch: 'main',
    head_sha: main,
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
  f.env = {
    WORKFLOW_SHA: main,
    STATUS_PHASE: 'result',
    INITIALIZATION_ATTEMPT: '1',
    BRIDGE_ATTEMPT: '1',
    CODEQL_RESULT: 'success',
    DETECTOR_RESULT: 'success',
  };
  f.github = {
    rest: {
      repos: {
        get: async () => {
          f.beforePublish?.();
          return { data: { full_name: repository, default_branch: 'main' } };
        },
        getCommit: async (x) => {
          assert.equal(x.ref, 'refs/pull/7/merge');
          return { data: f.merge };
        },
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
          if (f.failWrite === f.writes.length) {
            throw new Error('Interrupted publication');
          }
          f.writes.push(x);
        },
      },
      actions: { getWorkflowRun: async (x) => ({ data: x.run_id === 50 ? f.own : f.source }) },
      git: { getRef: async (x) => ({ data: { object: { sha: x.ref === 'heads/main' ? f.main : f.base } } }) },
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
    paginate: async (method, args) => {
      if (method === 'GET /repos/{owner}/{repo}/rules/branches/{branch}') {
        assert.equal(args.branch, 'next');
        assert.equal(args.per_page, 100);
        return f.rules;
      }
      if (method === f.github.rest.repos.listCommitStatusesForRef) {
        f.beforePublish?.();
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
for (const phase of ['pending', 'result']) {
  test(`forged newer Actions marker cannot skip ${phase} publication`, async () => {
    const f = fixture();
    await f.authorize();
    f.prior = [
      {
        context: 'Next CI / detect-breaking-changes',
        creator: { login: 'github-actions[bot]' },
        state: 'success',
        description: '[next-ci:v1:999999:99]',
        target_url: `https://github.com/${repository}/actions/runs/999999`,
      },
    ];
    f.env.STATUS_PHASE = phase;
    f.env.DETECTOR_RESULT = 'failure';
    await f.execute(phase === 'pending' ? 2 : 1);
    assert.equal(f.writes.length, 3);
    assert.equal(f.writes[2].state, phase === 'pending' ? 'pending' : 'failure');
    assert.equal(f.outputs.ready, 'true');
  });
}
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
  test(`final validation race: ${name}`, async () => {
    const f = fixture(kind);
    await f.authorize();
    f.beforePublish = () => mutate(f);
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
  const [authorize, initialize] = before.split('  initialize:');
  assert(!authorize.includes('statuses: write'));
  assert(initialize.includes('statuses: write'));
  assert(!initialize.includes('checkout@'));
  assert(!initialize.includes('run:'));
  assert(!initialize.includes('download-artifact'));
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
  // oxlint-disable-next-line no-template-curly-in-string -- This is a literal GitHub Actions expression.
  assert(validation.includes('candidate_sha: ${{ github.sha }}'));
  assert(!validation.includes('github.event.pull_request.head.sha'));
  assert(validation.includes('github.event.pull_request.base.sha'));
});
test('workflow API ref suffixes are accepted without weakening path checks', async () => {
  const f = fixture();
  f.own.path += '@main';
  f.source.path += '@refs/pull/7/merge';
  await f.authorize();
  await f.execute(1);
  assert.equal(f.writes.length, 3);
});
reject('wrong workflow remains rejected with a main suffix', (f) => {
  f.own.path = '.github/workflows/evil.yml@main';
});
test('PR scan uses authenticated merge tree while statuses attach to head', async () => {
  const f = fixture();
  await f.authorize();
  assert.equal(JSON.parse(f.outputs.receipt).scan, merge);
  await f.execute(1);
  assert(f.writes.every((x) => x.sha === head));
  assert.equal((yaml.match(/candidate_sha:.*receipt\)\.scan/gu) || []).length, 2);
});
reject('conflicted PR rejected', (f) => {
  f.pull.mergeable = false;
});
reject('missing merge SHA rejected', (f) => {
  f.pull.merge_commit_sha = null;
});
reject('stale merge base rejected', (f) => {
  f.merge.parents[0].sha = 'e'.repeat(40);
});
reject('stale merge head rejected', (f) => {
  f.merge.parents[1].sha = 'e'.repeat(40);
});
reject('foreign merge ref rejected', (f) => {
  f.merge.sha = 'e'.repeat(40);
});
reject(
  'merge ref change during checks prevents publication',
  (f) => {
    f.pull.merge_commit_sha = 'e'.repeat(40);
    f.merge.sha = 'e'.repeat(40);
  },
  1,
);
reject(
  'merge ref change before final validation prevents publication',
  (f) => {
    f.beforePublish = () => {
      f.pull.merge_commit_sha = 'e'.repeat(40);
      f.merge.sha = 'e'.repeat(40);
    };
  },
  1,
);
test('edited PR events trigger the ordinary CI signal', async () => {
  const ci = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf-8');
  assert(/pull_request:\n\s+types: \[[^\]]*edited/u.test(ci));
});
test('real tooling guard rejects candidate detector and toolchain substitution', async () => {
  const detector = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/detect-breaking-changes.yml'),
    'utf-8',
  );
  const [, guardStep] = detector.split('      - name: Reject untrusted detector tooling changes');
  const [guard] = guardStep.split('      - name: Set up pnpm');
  assert(guard.includes('github.workflow_sha'));
  // Execute the actual workflow diff command over real Git trees; never candidate code.
  const command = guard.slice(guard.indexOf('          git diff')).trim();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'next-detector-trust-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), contents);
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    write('scripts/detect-breaking-changes', 'exit 1');
    write('src/index.ts', 'export const value = 1');
    git('add', '.');
    git('commit', '-qm', 'trusted');
    const trusted = git('rev-parse', 'HEAD').trim();
    const check = () =>
      spawnSync('bash', ['-euc', command], {
        cwd: directory,
        env: { ...process.env, TRUSTED_WORKFLOW_SHA: trusted },
      }).status;
    for (const file of [
      'scripts/detect-breaking-changes',
      'scripts/lint',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      '.npmrc',
      '.pnpmfile.cjs',
      'oxlint.config.ts',
      'node_modules/.bin/tsc',
      'examples/node_modules/.bin/tsc',
      'examples/package.json',
      'examples/.npmrc',
      'src/oxfmt.config.ts',
    ]) {
      git('reset', '--hard', trusted);
      write(file, 'exit 0');
      git('add', '.');
      git('commit', '-qm', 'candidate tooling');
      assert.notEqual(check(), 0, file);
    }
    git('reset', '--hard', trusted);
    write('src/index.ts', 'export const value = 2');
    git('add', '.');
    git('commit', '-qm', 'candidate SDK');
    assert.equal(check(), 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
reject('loose next checks without merge queue are rejected', (f) => {
  f.rules = [{ type: 'required_status_checks' }];
});
reject(
  'merge queue removal prevents publication',
  (f) => {
    f.rules = [];
  },
  1,
);
reject('old main bridge rerun rejected at authorization', (f) => {
  f.main = 'e'.repeat(40);
});
reject('workflow SHA mismatch rejected at authorization', (f) => {
  f.env.WORKFLOW_SHA = 'e'.repeat(40);
});
reject(
  'main advance during compute prevents publication',
  (f) => {
    f.main = 'e'.repeat(40);
  },
  1,
);
reject(
  'main advance before final validation prevents publication',
  (f) => {
    f.beforePublish = () => {
      f.main = 'e'.repeat(40);
    };
  },
  1,
);
reject(
  'selected-job rerun cannot reuse an earlier pending initialization',
  (f) => {
    f.own.run_attempt = 2;
    f.env.BRIDGE_ATTEMPT = '2';
  },
  1,
);
test('effective queue rule on a later page is accepted', async () => {
  const f = fixture();
  f.rules = [
    ...Array.from({ length: 100 }, () => ({ type: 'required_status_checks' })),
    { type: 'merge_queue' },
  ];
  await f.authorize();
  await f.execute(1);
  assert.equal(f.writes.length, 3);
});
test('all contexts become pending before either scan may start', async () => {
  const f = fixture();
  await f.authorize();
  f.env.STATUS_PHASE = 'pending';
  await f.execute(2);
  assert.equal(f.writes.length, 3);
  assert(f.writes.every((x) => x.state === 'pending' && x.sha === head));
  assert.equal(f.outputs.ready, 'true');
  assert.equal(f.outputs.attempt, '1');
  assert.equal((yaml.match(/needs.initialize.outputs.attempt == github.run_attempt/gu) || []).length, 3);
  assert.equal((yaml.match(/needs: \[authorize, initialize\]/gu) || []).length, 2);
  assert.equal((yaml.match(/if: needs.initialize.outputs.ready == 'true'/gu) || []).length, 2);
});
test('partial pending publication cannot authorize scans', async () => {
  const f = fixture();
  await f.authorize();
  f.env.STATUS_PHASE = 'pending';
  f.failWrite = 1;
  await assert.rejects(() => f.execute(2));
  assert.equal(f.outputs.ready, undefined);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].state, 'pending');
});
test('interrupted result publication retains blocking pending detector', async () => {
  const f = fixture();
  await f.authorize();
  f.env.STATUS_PHASE = 'pending';
  await f.execute(2);
  f.env.STATUS_PHASE = 'result';
  f.env.DETECTOR_RESULT = 'failure';
  f.failWrite = 5;
  await assert.rejects(() => f.execute(1));
  const latest = new Map(f.writes.map((x) => [x.context, x.state]));
  assert.equal(latest.get('Next CI / detect-breaking-changes'), 'pending');
});
test('hosted validation covers every guarded tooling path and retargeting', async () => {
  const validation = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/next-ci-validation.yml'),
    'utf-8',
  );
  assert(validation.includes('types: [opened, synchronize, reopened, ready_for_review, edited]'));
  const detector = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/detect-breaking-changes.yml'),
    'utf-8',
  );
  const [, guardStep] = detector.split('          git diff');
  const [guard] = guardStep.split('      - name: Set up pnpm');
  for (const [, spec] of guard.matchAll(/'(?<path>[^']+)'/gu)) {
    let pattern = spec.replace(/^:\([^)]*\)/u, '');
    if (pattern === 'scripts' || pattern === 'node_modules') {
      pattern += '/**';
    }
    assert(validation.includes(`- '${pattern}'`), `Missing validation trigger: ${pattern}`);
  }
});
test('frozen baseline consumers expose API breaks masked by ambient ts and declaration files', async () => {
  const detector = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/detect-breaking-changes.yml'),
    'utf-8',
  );
  const restore = detector.match(
    /rm -rf tests examples\n\s+git archive "\$BASE_SHA" tests examples \| tar -x/u,
  )?.[0];
  assert(restore);
  assert(detector.indexOf(restore) < detector.lastIndexOf('./scripts/bootstrap'));
  // Restoring after installation deletes examples/node_modules and breaks pnpm verification.
  assert(detector.indexOf(restore) < detector.lastIndexOf('./scripts/detect-breaking-changes "$BASE_SHA"'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'next-consumer-fixtures-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), value);
  };
  const compile = () =>
    spawnSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--pretty',
        'false',
        '--project',
        path.join(directory, 'tsconfig.json'),
      ],
      { cwd: directory, encoding: 'utf-8' },
    );
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    write('src/index.ts', 'export default class SDK { removed() {} }');
    write('tests/consumer.ts', "import SDK from 'openai'; new SDK().removed();");
    write('examples/consumer.ts', 'export const example = true;');
    write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          types: [],
          module: 'preserve',
          moduleResolution: 'bundler',
          paths: { openai: ['./src/index.ts'] },
        },
        include: ['src', 'tests', 'examples'],
      }),
    );
    git('add', '.');
    git('commit', '-qm', 'trusted consumers');
    const baseline = git('rev-parse', 'HEAD').trim();
    assert.equal(compile().status, 0);
    for (const shim of ['tests/shadow.d.ts', 'examples/shadow.ts']) {
      write('src/index.ts', 'export default class SDK { present() {} }');
      write(shim, "declare module 'openai' { const SDK: any; export default SDK; }");
      git('add', '.');
      const masked = compile();
      assert.equal(masked.status, 0, masked.stdout);
      const restored = spawnSync('bash', ['-euo', 'pipefail', '-c', restore], {
        cwd: directory,
        env: { ...process.env, BASE_SHA: baseline },
        encoding: 'utf-8',
      });
      assert.equal(restored.status, 0, restored.stderr);
      assert(!fs.existsSync(path.join(directory, shim)));
      const detected = compile();
      assert.notEqual(detected.status, 0);
      assert(detected.stdout.includes("Property 'removed' does not exist"), detected.stdout);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
