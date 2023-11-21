export {};

test('throws if shims are imported after openai', async () => {
  await import('martian-node');
  await expect(() => import('martian-node/shims/web')).rejects.toThrow(
    `you must \`import 'martian-node/shims/web'\` before importing anything else from openai`,
  );
});
