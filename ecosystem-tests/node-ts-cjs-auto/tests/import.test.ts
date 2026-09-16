import OpenAI from 'openai';

test('loads the CommonJS entrypoint through Jest 28', () => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Verify that the installed package exports a callable constructor in this module-loading environment.
  expect(typeof OpenAI).toBe('function');
  expect(() => new OpenAI({ apiKey: 'test', dangerouslyAllowBrowser: true })).not.toThrow();
});
