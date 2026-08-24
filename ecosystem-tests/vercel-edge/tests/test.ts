const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const token = process.env.VERCEL_EDGE_TEST_TOKEN;

if (!token) {
  throw new Error('VERCEL_EDGE_TEST_TOKEN must be configured for live ecosystem tests');
}

const headers = { authorization: `Bearer ${token}` };

console.log(baseUrl);

it.each([
  'query-params',
  'vercel-ai-streaming',
  'response',
  'streaming',
  'transcribe',
  'edge-test',
  'node-test',
])('rejects unauthenticated access to /api/%s', async (route) => {
  const response = await fetch(`${baseUrl}/api/${route}`);

  expect(response.status).toBe(401);
});

it(
  'node runtime',
  async () => {
    const response = await fetch(`${baseUrl}/api/node-test`, { headers });
    expect(await response.text()).toEqual('Passed!');
  },
  3 * 60_000,
);

it(
  'edge runtime',
  async () => {
    const response = await fetch(`${baseUrl}/api/edge-test`, { headers });
    expect(await response.text()).toEqual('Passed!');
  },
  3 * 60_000,
);

// make isolatedModules happy
// oxlint-disable-next-line unicorn/require-module-specifiers -- keep this test file a module
export {};
