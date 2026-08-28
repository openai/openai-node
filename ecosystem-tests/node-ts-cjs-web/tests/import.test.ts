/**
 * @jest-environment jest-fixed-jsdom
 */
import OpenAI from 'openai';

test('loads the CommonJS entrypoint with browser export conditions', () => {
  expect(typeof OpenAI).toBe('function');
  expect(() => new OpenAI({ apiKey: 'test', dangerouslyAllowBrowser: true })).not.toThrow();
});
