const builtinRequire = require;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../.github/scripts/next-ci-policy.cjs'), 'utf-8');
const workflow = 'a'.repeat(40);
const pin = 'b'.repeat(40);
const base = 'c'.repeat(40);
const head = 'd'.repeat(40);
function fixture() {
  const f = {
    changedBlob: false,
    dismissed: false,
    selected: {
      schema_version: 1,
      target_branch: 'next',
      base_sha: base,
      head_sha: head,
      policy_sha: pin,
      bootstrap: false,
      policy_reviews: [],
    },
    calls: [],
    fetched: [],
    missingPolicy: false,
  };
  const fakeExec = (command, args) => {
    f.calls.push([command, args]);
    if (command === 'python3') {
      assert.equal(args[0], '-I');
      for (const file of ['custom_code_budget.py', 'custom_code_report.py', 'custom_code_policy.py']) {
        assert.equal(fs.readFileSync(path.join(path.dirname(args[1]), file), 'utf-8'), '# trusted selector');
      }
      assert.equal(args[args.indexOf('--source-workflow') + 1], '.github/workflows/ci.yml');
      if (f.dismissed) {
        throw new Error('next policy changes require an exact-head human approving review');
      }
      fs.writeFileSync(args[args.indexOf('--out') + 1], JSON.stringify(f.selected));
      return '';
    }
    assert.equal(command, 'git');
    if (args.includes('rev-list')) {
      return `${workflow}\n${'e'.repeat(40)}\n`;
    }
    return `${(f.changedBlob && args.at(-1).startsWith(pin) ? '2' : '1').repeat(40)}\n`;
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require: (name) => (name === 'node:child_process' ? { execFileSync: fakeExec } : builtinRequire(name)),
    module,
    Buffer,
  });
  f.receipt = {
    repository: 'openai/openai-node',
    kind: 'pull_request',
    base,
    head,
    source: { id: 42, head_sha: head, event: 'pull_request', run_attempt: 1 },
  };
  f.github = {
    rest: {
      repos: {
        getContent: async ({ ref, path: file }) => {
          assert.equal(ref, workflow);
          f.fetched.push(file);
          if (f.missingPolicy && file.endsWith('/custom_code_policy.py')) {
            throw new Error('policy module unavailable');
          }
          assert(
            [
              'scripts/castiron/custom_code_budget.py',
              'scripts/castiron/custom_code_report.py',
              'scripts/castiron/custom_code_policy.py',
            ].includes(file),
          );
          return {
            data: {
              type: 'file',
              encoding: 'base64',
              content: Buffer.from('# trusted selector').toString('base64'),
            },
          };
        },
      },
    },
  };
  f.run = (expected) =>
    module.exports.selectPolicy({
      github: f.github,
      repository: 'openai/openai-node',
      workflowSha: workflow,
      receipt: f.receipt,
      expected,
    });
  return f;
}
(async () => {
  try {
    let f = fixture();
    const selected = await f.run();
    assert.equal(selected.policy_sha, pin);
    // An unrelated main advance preserves the reviewed base-selected policy.
    await f.run(selected);
    f.changedBlob = true;
    f.selected.policy_reviews = [{ number: 7, head_sha: head }];
    const upgraded = await f.run();
    assert.equal(upgraded.policy_sha, pin);
    assert(!f.calls.some(([command, args]) => command === 'git' && args.includes('rev-parse')));
    await f.run(upgraded);
    f = fixture();
    f.selected.base_sha = 'f'.repeat(40);
    await assert.rejects(() => f.run());
    f = fixture();
    const prior = await f.run();
    f.dismissed = true;
    await assert.rejects(() => f.run(prior), /human approving/u);
    f = fixture();
    const before = await f.run();
    f.selected.policy_sha = 'f'.repeat(40);
    await assert.rejects(() => f.run(before), /authorization changed/u);
    f = fixture();
    f.receipt.source.head_sha = 'f'.repeat(40);
    await assert.rejects(() => f.run());
    assert.equal(f.calls.length, 0);
    await Promise.all(
      [undefined, null, true, false, 0, 2, '1'].map(async (version) => {
        const invalid = fixture();
        invalid.selected.schema_version = version;
        await assert.rejects(() => invalid.run(), /Unsupported policy selection receipt version/u);
      }),
    );
    f = fixture();
    f.missingPolicy = true;
    await assert.rejects(() => f.run(), /policy module unavailable/u);
    assert.equal(f.calls.length, 0);
    console.log('14 focused selector-helper cases including reviewed wrapper upgrade passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
