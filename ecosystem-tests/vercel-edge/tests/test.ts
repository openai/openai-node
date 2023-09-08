import fetch from 'node-fetch';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
console.log(baseUrl);

it(
  'node runtime',
  async () => {
    expect(await (await fetch(`${baseUrl}/api/node-test`)).text()).toEqual('Passed!');
  },
  3 * 60000,
);

it(
  'edge runtime',
  async () => {
    expect(await (await fetch(`${baseUrl}/api/edge-test`)).text()).toEqual('Passed!');
  },
  3 * 60000,
);
