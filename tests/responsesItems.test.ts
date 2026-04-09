import OpenAI from 'openai/index';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses';

const openai = new OpenAI({ apiKey: 'example-api-key' });

function isInputCompatibleOutputItem(
  item: OpenAI.Responses.ResponseOutputItem,
): item is Exclude<OpenAI.Responses.ResponseOutputItem, OpenAI.Responses.ResponseComputerToolCallOutputItem> {
  return item.type !== 'computer_call_output';
}

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

  const history: Array<ResponseInputItem | ResponseOutputItem> = [
    {
      type: 'function_call_output',
      call_id: 'call_123',
      output: 'done',
    },
    ...response.output,
  ];

  await openai.responses.create({
    model: 'gpt-5.1',
    // check type compatibility
    input: response.output.filter(isInputCompatibleOutputItem),
  });
  await openai.responses.create({
    model: 'gpt-5.1',
    // check mixed history normalization
    input: toResponseInputItems(history),
  });
  expect(true).toBe(true);
};
