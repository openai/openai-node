/**
 * @jest-environment jsdom
 */

export {};

test('martian-node/shims/web throws if globals are missing', async () => {
  await expect(() => import('martian-node/shims/web')).rejects.toThrow(
    `this environment is missing the following Web Fetch API type: fetch is not defined. You may need to use polyfills`,
  );
});
