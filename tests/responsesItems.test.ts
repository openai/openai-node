import OpenAI from 'openai/index';
const openai = new OpenAI({ apiKey: 'example-api-key' });

describe('responses item types', () => {
  test('response output items are compatible with input items', async () => {
    expect(true).toBe(true);
  });
});

const unused = async () => {
  const response = await openai.responses.create({
    model: 'gpt-5.1',
    input: 'You are a helpful assistant.',
  });
  await openai.responses.create({
    model: 'gpt-5.1',
    // check type compatibility
    input: response.output,
  });
  expect(true).toBe(true);
};
