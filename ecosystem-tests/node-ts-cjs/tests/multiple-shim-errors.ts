export {};

test('throws if multiple shims are imported', async () => {
  await import('martian-node/shims/node');
  await expect(() => import('martian-node/shims/web')).rejects.toThrow(
    `can't \`import 'martian-node/shims/web'\` after \`import 'martian-node/shims/node'\``,
  );
});
