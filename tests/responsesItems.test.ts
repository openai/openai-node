import OpenAI from 'openai/index';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type {
  BetaResponseInputItem,
  BetaResponseOutputItem,
} from 'openai/resources/beta/responses/responses';
import type { ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses/responses';
import { expectType } from './utils/typing';

const openai = new OpenAI({ apiKey: 'example-api-key' });

function isInputCompatibleOutputItem(
  item: OpenAI.Responses.ResponseOutputItem,
): item is Exclude<
  OpenAI.Responses.ResponseOutputItem,
  OpenAI.Responses.ResponseComputerToolCallOutputItem | OpenAI.Responses.ResponseOutputItem.AdditionalTools
> {
  return item.type !== 'computer_call_output' && item.type !== 'additional_tools';
}

describe('responses item types', () => {
  test('incomplete web search calls are valid stable and beta input and output items', () => {
    const item = {
      id: 'ws_123',
      type: 'web_search_call',
      status: 'incomplete',
      action: { type: 'search', query: 'synthetic query' },
    } as const;

    expectType<ResponseOutputItem>(item);
    expectType<ResponseInputItem>(item);
    expectType<BetaResponseOutputItem>(item);
    expectType<BetaResponseInputItem>(item);
  });

  test('response output items are compatible with input items', async () => {
    expect(true).toBe(true);
  });
});

const unused = async () => {
  const response = await openai.responses.create({
    model: 'gpt-5.1',
    input: 'You are a helpful assistant.',
  });

  const history: (ResponseInputItem | ResponseOutputItem)[] = [
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
