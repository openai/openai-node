import type OpenAI from 'openai';
import type { ResponsesRunnerTurn } from 'openai/helpers/responses-tool-runner';
import { test } from 'vitest';

// Compile-only: inline literals must pass excess-property checks without casts.
const compile = (client: OpenAI, turn: ResponsesRunnerTurn) => {
  turn.supplyOutputs([
    {
      type: 'function_call_output',
      call_id: 'call_1',
      output: [
        { type: 'input_text', text: 'result', prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' } },
        {
          type: 'input_image',
          image_url: 'https://example.com/image.png',
          prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' },
        },
        { type: 'input_file', file_id: 'file_1', prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' } },
      ],
    },
  ]);
  client.responses.create({
    model: 'gpt-5',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'question', prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' } },
          {
            type: 'input_image',
            image_url: 'https://example.com/image.png',
            detail: 'auto',
            prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' },
          },
          {
            type: 'input_file',
            file_id: 'file_1',
            prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' },
          },
        ],
      },
    ],
  });
  client.beta.responses.create({
    model: 'gpt-5',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'question', prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' } },
          {
            type: 'input_image',
            image_url: 'https://example.com/image.png',
            detail: 'auto',
            prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' },
          },
          {
            type: 'input_file',
            file_id: 'file_1',
            prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' },
          },
        ],
      },
    ],
  });
};

test('accepts inline Responses breakpoint TTLs through public client and runner types', () => {
  void compile;
});
