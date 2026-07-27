(() => {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');

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
    version: string;
    experimental: boolean;
  }

  const readmePolicyURL = 'https://github.com/openai/openai-node/blob/main/NODE_VERSION_POLICY.md';

  const required = <Value>(value: Value | undefined, message: string): Value => {
    if (value === undefined) {
      throw new Error(message);
    }
    return value;
  };
  const isPolicyStatus = (value: string): value is PolicyStatus =>
    policyStatuses.some((status) => status === value);

  const root = path.resolve(__dirname, '..');
  const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');
  const readJSON = <Value>(file: string): Value => JSON.parse(read(file)) as Value;
  const unique = <Value>(values: Value[]): Value[] => [...new Set(values)];
  const major = (version: string): string =>
    required(/^(\d+)(?:\.\d+\.\d+)?$/.exec(version)?.[1], `Invalid Node.js version in CI: ${version}`);

  const packageJSON = readJSON<PackageMetadata>('package.json');
  const ci = read('.github/workflows/ci.yml');
  const readme = read('README.md');
  const contributing = read('CONTRIBUTING.md');
  const policyDocument = read('NODE_VERSION_POLICY.md');

  const engineMatch = /^>=(\d+)\.0\.0$/.exec(packageJSON.engines?.node ?? '');
  const engineMinimum = required(
    engineMatch?.[1],
    'package.json#engines.node must have the form >=<major>.0.0',
  );

  const matrixEntries: MatrixEntry[] = Array.from(
    ci.matchAll(/^\s+- node-version: '([^']+)'\r?\n\s+experimental: (true|false)$/gm),
    (match) => ({
      version: required(match[1], 'CI contains an empty Node.js matrix entry'),
      experimental: match[2] === 'true',
    }),
  );
  assert(matrixEntries.length > 0, 'CI is missing its Node.js version matrix');
  assert.equal(
    new Set(matrixEntries.map(({ version }) => version)).size,
    matrixEntries.length,
    'CI Node.js matrix contains duplicate versions',
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
  const matrixSupported = matrixEntries
    .filter(({ experimental }) => !experimental)
    .map(({ version }) => version);
  const matrixForward = matrixEntries
    .filter(({ experimental }) => experimental)
    .map(({ version }) => version);

  assert(
    matrixSupported.every((version) => /^\d+$/.test(version)),
    'Supported CI versions must be major lines',
  );
  assert.deepEqual(
    policyRows.map(({ major: version }) => version),
    [...policyRows]
      .sort((left, right) => Number(left.major) - Number(right.major))
      .map(({ major: version }) => version),
    'NODE_VERSION_POLICY.md compatibility rows must be ordered by major',
  );
  assert.equal(
    new Set(matrixForward.map(major)).size,
    matrixForward.length,
    'Experimental CI must contain at most one entry per Node.js major',
  );
  assert.deepEqual(
    matrixSupported.map(major),
    policySupported,
    'Blocking CI versions must exactly match supported policy lines',
  );
  assert.deepEqual(
    unique(matrixForward.map(major)),
    policyForward,
    'Experimental CI versions must exactly match forward-tested policy lines',
  );

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

  const latestLTSMatch = ci.match(/^\s*LATEST_LTS_NODE_VERSION: '([^']+)'$/m);
  const recommended = required(latestLTSMatch?.[1], 'CI is missing LATEST_LTS_NODE_VERSION');
  assert.equal(
    required(policyRecommended[0], 'Policy is missing its recommended line').major,
    recommended,
    'LATEST_LTS_NODE_VERSION must match the recommended policy line',
  );
  assert.equal(
    required(policySupported[policySupported.length - 1], 'Policy has no supported Node.js lines'),
    recommended,
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
  assert(contributing.includes('(NODE_VERSION_POLICY.md)'), 'CONTRIBUTING does not link the Node.js policy');
  assert(
    ci.includes('scripts/test-packed-package.ts'),
    'CI does not test the packed npm artifact on supported Node.js lines',
  );

  for (const version of matrixForward.filter((version) => version.includes('.'))) {
    assert(
      policyDocument.includes(`\`${version}\``),
      `NODE_VERSION_POLICY.md must document the temporary Node.js ${version} pin`,
    );
  }

  console.log(
    `Node.js policy is aligned: minimum ${engineMinimum}; supported ${matrixSupported.join(
      ', ',
    )}; forward-tested ${matrixForward.join(', ') || 'none'}.`,
  );
})();
