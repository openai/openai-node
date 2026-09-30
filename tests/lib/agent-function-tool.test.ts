import { describe, expect, test, vi } from 'vitest';
import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod/v4';
import * as mini from 'zod/v4-mini';
import OpenAI from 'openai';
import { zodResponsesFunction } from 'openai/helpers/zod';
import { standardResponsesFunction } from 'openai/helpers/standard-schema';
import { functionTool } from 'openai/lib/beta/agents/function-tool';
import { expectType } from '../utils/typing';

describe('beta Agents functionTool', () => {
  test('sends the hosted definition at creation without invoking the local wallet action', async () => {
    const action = vi.fn(() => ({ balance: '12.50' }));
    const tool = functionTool(
      zodResponsesFunction({
        name: 'wallet_balance',
        parameters: z4.object({ asset: z4.string() }),
        function: action,
      }),
    );
    const bodies: unknown[] = [];
    const client = new OpenAI({
      apiKey: 'sk-synthetic-agents-test',
      fetch: async (url, init) => {
        bodies.push(await new Request(url, init).json());
        return Response.json({ id: 'session_test', status: 'in_progress' });
      },
    });
    await client.beta.agents.sessions.create({
      agent: { model: 'model_test', tools: [tool.definition] },
      environment: { type: 'none' },
      input: 'Reply READY without calling tools.',
    });
    expect(bodies).toEqual([
      {
        agent: { model: 'model_test', tools: [tool.definition] },
        environment: { type: 'none' },
        input: 'Reply READY without calling tools.',
      },
    ]);
    expect(action).not.toHaveBeenCalled();
  });

  test.each([
    z3.object({ asset: z3.string() }),
    z4.object({ asset: z4.string() }),
    mini.object({ asset: mini.string() }),
  ])('reuses Zod validation and exposes only the flat Agents definition', async (parameters) => {
    const execute = vi.fn(({ asset }: { asset: string }) => ({ asset, balance: '12.50' }));
    const parsed = zodResponsesFunction({
      name: 'wallet_balance',
      description: 'Read a wallet balance.',
      parameters,
      function: (args) => {
        expectType<{ asset: string }>(args);
        return execute(args);
      },
    });
    const tool = functionTool(parsed);

    // oxlint-disable-next-line unicorn/prefer-structured-clone -- Verify the actual JSON wire representation, including omitted metadata.
    expect(JSON.parse(JSON.stringify(tool.definition))).toEqual({
      type: 'function',
      name: 'wallet_balance',
      description: 'Read a wallet balance.',
      parameters: parsed.parameters,
    });
    expect(tool.name).toBe('wallet_balance');
    expect(await tool.handler({ asset: 'USDC' })).toEqual({ asset: 'USDC', balance: '12.50' });
    await expect(tool.handler({ asset: 123 })).rejects.toThrow();
    expect(execute).toHaveBeenCalledExactlyOnceWith({ asset: 'USDC' });
  });

  test('reuses Standard Schema output inference, validation, and asynchronous callbacks', async () => {
    const execute = vi.fn(async (asset: string) => ({ balance: '12.50', asset }));
    const tool = functionTool(
      standardResponsesFunction({
        name: 'wallet_balance',
        parameters: z4
          .object({ asset: z4.string() })
          .transform(({ asset }) => ({ asset: asset.toUpperCase() })),
        schema: { type: 'object', properties: { asset: { type: 'string' } }, required: ['asset'] },
        function: (args) => {
          expectType<{ asset: string }>(args);
          return execute(args.asset);
        },
      }),
    );
    expect(tool.definition.description).toBe('');
    expect(await tool.handler({ asset: 'usdc' })).toEqual({ asset: 'USDC', balance: '12.50' });
    await expect(tool.handler({ asset: false })).rejects.toThrow();
    expect(execute).toHaveBeenCalledExactlyOnceWith('USDC');
  });

  test('requires an executable callback before a session can start', () => {
    expect(() => functionTool(zodResponsesFunction({ name: 'balance', parameters: z4.object({}) }))).toThrow(
      'require a callback',
    );
  });

  test.each([
    [42, '42'],
    [false, 'false'],
    [undefined, 'undefined'],
    [null, null],
    ['text', 'text'],
    [{ receipt: 'synthetic' }, { receipt: 'synthetic' }],
    [[1, 2], '[1,2]'],
    [[{ type: 'input_text', status: 'pending' }], '[{"type":"input_text","status":"pending"}]'],
    [
      { type: 'input_text', text: 'business record' },
      { type: 'input_text', text: 'business record' },
    ],
    [
      [{ type: 'input_image', image_url: 'https://example.com/image.png' }],
      [{ type: 'input_image', image_url: 'https://example.com/image.png' }],
    ],
  ])('normalizes callback result %j for the existing dispatcher', async (value, expected) => {
    const tool = functionTool(
      zodResponsesFunction({ name: 'result', parameters: z4.object({}), function: async () => value }),
    );
    expect(await tool.handler({})).toEqual(expected);
  });

  test('rejects non-JSON callback results', async () => {
    const tool = functionTool(
      zodResponsesFunction({ name: 'result', parameters: z4.object({}), function: () => Symbol('not JSON') }),
    );
    await expect(tool.handler({})).rejects.toThrow('JSON serializable');
  });

  test('preserves deferred discovery without forwarding Responses-only fields', () => {
    const parsed = zodResponsesFunction({ name: 'balance', parameters: z4.object({}), function: () => null });
    parsed.defer_loading = false;
    const tool = functionTool(parsed);
    expect(tool.definition.defer_loading).toBe(false);
    expect(tool.definition).not.toHaveProperty('strict');
    expect(tool.definition).not.toHaveProperty('$callback');
    expect(tool.definition).not.toHaveProperty('$parseRaw');
  });
});
