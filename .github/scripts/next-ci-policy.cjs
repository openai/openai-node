// Trusted-main bridge helper. Never load this module from the candidate checkout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const policyFiles = [
  'scripts/castiron/custom_code_budget.py',
  'scripts/castiron/custom_code_report.py',
  'scripts/castiron/custom_code_policy.py',
];
const sha = (value) => {
  assert.match(value || '', /^[0-9a-f]{40}$/u);
  return value;
};

// Repeated by the isolated publisher immediately before its final live-target
// checks and status writes. Canonical selection revalidates human policy reviews.
async function selectPolicy({ github, repository, workflowSha, receipt, expected }) {
  assert.equal(repository, 'openai/openai-node');
  sha(workflowSha);
  assert.equal(receipt.repository, repository);
  assert(['pull_request', 'merge_group'].includes(receipt.kind));
  sha(receipt.base);
  sha(receipt.head);
  // The caller authenticates this ordinary CI signal, including manual dispatch.
  // The canonical selector independently reads its actual current run identity.
  assert(receipt.source && Number.isSafeInteger(receipt.source.id) && receipt.source.id > 0);
  assert.equal(receipt.source.head_sha, receipt.head);
  assert.equal(receipt.source.event, receipt.kind);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'next-ci-policy-'));
  try {
    const [owner, repo] = repository.split('/');
    await Promise.all(
      policyFiles.map(async (file) => {
        const { data } = await github.rest.repos.getContent({ owner, repo, path: file, ref: workflowSha });
        assert.equal(data.type, 'file');
        assert.equal(data.encoding, 'base64');
        fs.writeFileSync(path.join(directory, path.basename(file)), Buffer.from(data.content, 'base64'));
      }),
    );
    const event = path.join(directory, 'event.json');
    const out = path.join(directory, 'selected.json');
    const objects = path.join(directory, 'objects');
    fs.writeFileSync(
      event,
      JSON.stringify({ repository: { full_name: repository }, workflow_run: receipt.source }),
    );
    execFileSync(
      'python3',
      [
        '-I',
        path.join(directory, 'custom_code_budget.py'),
        'select-policy',
        '--repo',
        objects,
        '--repository',
        repository,
        '--event-path',
        event,
        '--trusted-sha',
        workflowSha,
        '--source-workflow',
        '.github/workflows/ci.yml',
        '--out',
        out,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const selected = JSON.parse(fs.readFileSync(out, 'utf-8'));
    assert.equal(selected.schema_version, 1, 'Unsupported policy selection receipt version');
    assert.equal(selected.target_branch, 'next');
    assert.equal(selected.head_sha, receipt.head);
    assert.equal(selected.base_sha, receipt.base);
    sha(selected.policy_sha);
    const git = (...args) =>
      execFileSync('git', ['-C', objects, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    assert(git('rev-list', '--first-parent', 'refs/remotes/origin/main').split('\n').includes(workflowSha));
    // This authenticated main wrapper transports the canonical selection only.
    // Detector tooling and effective policy remain selected by the protected base.
    if (expected) {
      assert.deepEqual(selected, expected, 'Protected policy authorization changed');
    }
    return selected;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
module.exports = { selectPolicy };
