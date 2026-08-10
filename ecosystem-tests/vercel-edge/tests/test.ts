const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
console.log(baseUrl);

it(
  'node runtime',
  async () => {
    const response = await fetch(`${baseUrl}/api/node-test`);
    expect(await response.text()).toEqual('Passed!');
  },
  3 * 60_000,
);

it(
  'edge runtime',
  async () => {
    const response = await fetch(`${baseUrl}/api/edge-test`);
    expect(await response.text()).toEqual('Passed!');
  },
  3 * 60_000,
);

// make isolatedModules happy
// oxlint-disable-next-line unicorn/require-module-specifiers -- keep this test file a module
export {};
