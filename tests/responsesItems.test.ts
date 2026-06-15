import OpenAI from 'openai/index';
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
  test('response output items are compatible with input items', async () => {
    expect(true).toBe(true);
  });

  test('mcp_call output items accept structured errors', () => {
    const item: OpenAI.Responses.ResponseOutputItem.McpCall = {
      id: 'mcp_abc',
      type: 'mcp_call',
      approval_request_id: null,
      arguments: '{"query":"latest tech gadgets"}',
      error: {
        type: 'mcp_protocol_error',
        code: 32600,
        message: 'Session terminated',
      },
      name: 'search',
      output: null,
      server_label: 'my-mcp-server',
    };

    expect(item.error).toMatchObject({ message: 'Session terminated' });
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
    input: response.output.filter(isInputCompatibleOutputItem),
  });
  expect(true).toBe(true);
};
