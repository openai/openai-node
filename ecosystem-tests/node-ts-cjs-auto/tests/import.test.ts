import OpenAI from 'openai';

test('loads the CommonJS entrypoint through Jest 28', () => {
  expect(typeof OpenAI).toBe('function');
  expect(() => new OpenAI({ apiKey: 'test', dangerouslyAllowBrowser: true })).not.toThrow();
});
