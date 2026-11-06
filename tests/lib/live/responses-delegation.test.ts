import { expect, expectTypeOf, test } from 'vitest';
import OpenAI from 'openai';
import type { ResponsesDelegationConfig, ResponsesDelegationUpdateConfig } from 'openai/resources/live/live';
import { expectType } from '../../utils/typing';

const functionChoice: ResponsesDelegationConfig.LiveFunctionToolChoiceParam = {
  type: 'function',
  name: 'lookup',
};
const mcpChoice: ResponsesDelegationConfig.LiveMCPToolChoiceParam = {
  type: 'mcp',
  server_label: 'inventory',
  name: 'lookup',
};

type ToolChoice = NonNullable<
  ResponsesDelegationConfig['tool_choice'] | ResponsesDelegationUpdateConfig['tool_choice']
>;

test('keeps existing choices usable in creation and update models', () => {
  expectType<ResponsesDelegationUpdateConfig.LiveFunctionToolChoiceParam>(functionChoice);
  expectType<ResponsesDelegationUpdateConfig.LiveMCPToolChoiceParam>(mcpChoice);

  const tools = [{ type: 'mcp' }, { type: 'custom' }] satisfies NonNullable<
    ResponsesDelegationConfig['tools']
  >;
  for (const toolChoice of [functionChoice, mcpChoice]) {
    expectType<ResponsesDelegationConfig>({ model: 'gpt-test', tools, tool_choice: toolChoice });
    expectType<ResponsesDelegationUpdateConfig>({ tools, tool_choice: toolChoice });
  }

  expectTypeOf<{ type: 'function' }>().not.toMatchTypeOf<ToolChoice>();
  expectTypeOf<{ type: 'mcp'; server_label: string }>().not.toMatchTypeOf<ToolChoice>();
  expectTypeOf<{ type: 'mcp'; name: string }>().not.toMatchTypeOf<ToolChoice>();
  expectType<ResponsesDelegationConfig>({ model: 'gpt-test', tool_choice: { type: 'file_search' } });
  expectType<ResponsesDelegationUpdateConfig>({ tool_choice: { type: 'custom', name: 'lookup' } });
});

test('serializes delegated tools and allowed choices', async () => {
  const bodies: unknown[] = [];
  const client = new OpenAI({
    apiKey: 'test-key',
    fetch: async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return new Response(null, { status: 204 });
    },
  });

  await client.live.sessions.accept('session_test', {
    session: {
      type: 'live',
      model: 'gpt-live-1',
      delegation: {
        type: 'responses',
        responses: {
          model: 'gpt-test',
          tools: [
            { type: 'function', name: 'lookup' },
            { type: 'shell', environment: { type: 'local' } },
          ],
          tool_choice: { type: 'allowed_tools', tools: [functionChoice, { type: 'shell' }] },
        },
      },
    },
  });

  expect(bodies).toEqual([
    {
      session: {
        type: 'live',
        model: 'gpt-live-1',
        delegation: {
          type: 'responses',
          responses: {
            model: 'gpt-test',
            tools: [
              { type: 'function', name: 'lookup' },
              { type: 'shell', environment: { type: 'local' } },
            ],
            tool_choice: {
              type: 'allowed_tools',
              tools: [{ type: 'function', name: 'lookup' }, { type: 'shell' }],
            },
          },
        },
      },
    },
  ]);
});
