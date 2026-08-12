const nodeVersionPolicyAssert = require('node:assert/strict');
const nodeVersionPolicyFs = require('node:fs');
const nodeVersionPolicyPath = require('node:path');

(() => {
  const assert = nodeVersionPolicyAssert;
  const fs = nodeVersionPolicyFs;
  const path = nodeVersionPolicyPath;
  interface PackageMetadata {
    engines?: {
      node?: string;
    };
  }

  const policyStatuses = [
    'Unsupported',
    'Supported minimum',
    'Supported',
    'Supported and recommended',
    'Forward-tested only',
  ] as const;
  type PolicyStatus = (typeof policyStatuses)[number];

  interface PolicyRow {
    major: string;
    status: PolicyStatus;
  }

  interface MatrixEntry {
    'node-version': string;
    experimental: boolean;
  }

  const readmePolicyURL = 'https://github.com/openai/openai-node/blob/main/NODE_VERSION_POLICY.md';
  const options = process.argv.slice(2);
  assert(
    options.every((option) => option === '--matrix') && options.length <= 1,
    'Usage: check-node-version-policy.ts [--matrix]',
  );
  const emitMatrix = options.includes('--matrix');

  const required = <Value>(value: Value | undefined, message: string): Value => {
    if (value === undefined) {
      throw new Error(message);
    }
    return value;
  };
  const isPolicyStatus = (value: string): value is PolicyStatus =>
    policyStatuses.some((status) => status === value);

  const root = path.resolve(__dirname, '..');
  const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf-8');
  const readJSON = <Value>(file: string): Value => JSON.parse(read(file)) as Value;
  const unique = <Value>(values: Value[]): Value[] => [...new Set(values)];

  const packageJSON = readJSON<PackageMetadata>('package.json');
  const ci = read('.github/workflows/ci.yml');
  const repositoryNodeVersion = read('.nvmrc').trim();
  const readme = read('README.md');
  const contributing = read('.github/CONTRIBUTING.md');
  const policyDocument = read('NODE_VERSION_POLICY.md');

  const engineMatch = /^>=(\d+)\.0\.0$/.exec(packageJSON.engines?.node ?? '');
  const engineMinimum = required(
    engineMatch?.[1],
    'package.json#engines.node must have the form >=<major>.0.0',
  );

  const policyRows: PolicyRow[] = Array.from(
    policyDocument.matchAll(/^\|\s*(\d+)\s*\|[^|]*\|\s*([^|]+?)\s*\|/gm),
    (match) => {
      const status = required(match[2], 'Node.js policy contains a row without an OpenAI status').trim();
      if (!isPolicyStatus(status)) {
        throw new Error(`NODE_VERSION_POLICY.md contains an unknown status: ${status}`);
      }
      return {
        major: required(match[1], 'Node.js policy contains a row without a version'),
        status,
      };
    },
  );
  assert(policyRows.length > 0, 'NODE_VERSION_POLICY.md has no compatibility rows');
  assert.equal(
    new Set(policyRows.map(({ major: version }) => version)).size,
    policyRows.length,
    'NODE_VERSION_POLICY.md contains duplicate Node.js lines',
  );

  const supportedStatuses = new Set<PolicyStatus>([
    'Supported minimum',
    'Supported',
    'Supported and recommended',
  ]);
  const policySupported = policyRows
    .filter(({ status }) => supportedStatuses.has(status))
    .map(({ major: version }) => version);
  const policyForward = policyRows
    .filter(({ status }) => status === 'Forward-tested only')
    .map(({ major: version }) => version);
  const matrixEntries: MatrixEntry[] = [
    ...policySupported.map((version) => ({
      'node-version': version,
      experimental: false,
    })),
    ...policyForward.map((version) => ({
      'node-version': version,
      experimental: true,
    })),
  ];

  assert(
    [...policySupported, ...policyForward].every((version) => /^\d+$/.test(version)),
    'Policy matrix versions must be major lines',
  );
  const sortedPolicyRows = [...policyRows];
  sortedPolicyRows.sort((left, right) => Number(left.major) - Number(right.major));
  assert.deepEqual(
    policyRows.map(({ major: version }) => version),
    sortedPolicyRows.map(({ major: version }) => version),
    'NODE_VERSION_POLICY.md compatibility rows must be ordered by major',
  );
  assert(matrixEntries.length > 0, 'Policy produces an empty Node.js test matrix');

  const policyMinimum = policyRows.filter(({ status }) => status === 'Supported minimum');
  const policyRecommended = policyRows.filter(({ status }) => status === 'Supported and recommended');
  assert.equal(policyMinimum.length, 1, 'Policy must identify exactly one supported minimum');
  assert.equal(
    policyRecommended.length,
    1,
    'Policy must identify exactly one supported and recommended line',
  );
  assert.equal(
    required(policyMinimum[0], 'Policy is missing its supported minimum').major,
    engineMinimum,
    'package.json#engines.node must match the policy minimum',
  );
  assert.equal(
    required(policySupported[0], 'Policy has no supported Node.js lines'),
    engineMinimum,
    'The engine minimum must be the oldest supported Node.js line',
  );

  assert.equal(
    required(policyRecommended[0], 'Policy is missing its recommended line').major,
    repositoryNodeVersion,
    '.nvmrc must match the recommended policy line',
  );
  assert.equal(
    required(policySupported[policySupported.length - 1], 'Policy has no supported Node.js lines'),
    repositoryNodeVersion,
    'The recommended Node.js line must be the newest supported line',
  );

  const readmeNodeLine = required(
    readme.match(/^- Node\.js [^\r\n]+$/m)?.[0],
    'README is missing its Node.js runtime requirement',
  );
  const readmeSupported = unique(
    Array.from(readmeNodeLine.matchAll(/\b(\d+)\b/g), (match) =>
      required(match[1], 'README contains an empty Node.js version'),
    ),
  );
  assert.deepEqual(
    readmeSupported,
    policySupported,
    'README Node.js versions must exactly match supported policy lines',
  );
  assert(readme.includes(`](${readmePolicyURL})`), 'README does not link to the published Node.js policy');
  assert(
    contributing.includes('(../NODE_VERSION_POLICY.md)'),
    '.github/CONTRIBUTING.md does not link the Node.js policy',
  );
  assert(
    ci.includes('scripts/test-packed-package.ts'),
    'CI does not test the packed npm artifact on supported Node.js lines',
  );
  assert(
    ci.includes('scripts/check-node-version-policy.ts --matrix'),
    'CI does not read its Node.js matrix from the policy checker',
  );
  assert(
    ci.includes('fromJSON(needs.node_matrix.outputs.matrix)'),
    'CI does not consume the policy-generated Node.js matrix',
  );

  if (emitMatrix) {
    process.stdout.write(JSON.stringify({ include: matrixEntries }));
  } else {
    console.log(
      `Node.js policy is aligned: minimum ${engineMinimum}; supported ${policySupported.join(
        ', ',
      )}; forward-tested ${policyForward.join(', ') || 'none'}.`,
    );
  }
})();
