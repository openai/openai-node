export {};

test('throws if multiple shims are imported', async () => {
  await import('openai/shims/node');
  await expect(() => import('openai/shims/web')).rejects.toThrow(
    `can't \`import 'openai/shims/web'\` after \`import 'openai/shims/node'\``,
  );
});
