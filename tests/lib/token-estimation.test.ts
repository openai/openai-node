import { estimateTokens } from 'openai';

describe('token estimation', () => {
  test('includes file content parts in message token estimates', () => {
    const withoutFile = estimateTokens({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const withFile = estimateTokens({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: 'notes.txt',
                file_data: 'x'.repeat(350),
              },
            },
          ],
        },
      ],
    });

    expect(withFile.inputTokens).toBeGreaterThan(withoutFile.inputTokens);
  });

  test('does not infer context windows from broad model prefixes', () => {
    const unknownFutureModel = estimateTokens({
      model: 'gpt-4.5-preview',
      messages: [],
    });
    const knownExactModel = estimateTokens({
      model: 'gpt-4o-2024-05-13',
      messages: [],
    });

    expect(unknownFutureModel.contextWindow).toBeUndefined();
    expect(unknownFutureModel.maxOutputTokens).toBeUndefined();
    expect(knownExactModel.contextWindow).toEqual(128000);
  });
});
