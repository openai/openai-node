/**
 * @jest-environment jsdom
 */

export {};

it(`throws when fetch API types are missing`, async () => {
  await expect(() => import('martian-node')).rejects.toThrow(
    'this environment is missing the following Web Fetch API type',
  );
});
