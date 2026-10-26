import { expect, test, vi } from 'vitest';
import type { ResponsesRunnerTurn } from 'openai/helpers/responses-tool-runner';

test.each(['30m', '12h'] as const)('accepts inline native outputs with TTL %s without casts', (ttl) => {
  const supplyOutputs = vi.fn<ResponsesRunnerTurn['supplyOutputs']>();

  supplyOutputs([
    {
      type: 'function_call_output',
      call_id: 'call_fixture',
      output: [
        {
          type: 'input_text',
          text: 'fixture',
          prompt_cache_breakpoint: { mode: 'explicit', ttl },
        },
        {
          type: 'input_image',
          image_url: 'https://fixture.invalid/image',
          detail: 'auto',
          prompt_cache_breakpoint: { mode: 'explicit', ttl },
        },
        {
          type: 'input_file',
          file_id: 'file_fixture',
          prompt_cache_breakpoint: { mode: 'explicit', ttl },
        },
      ],
    },
  ]);

  expect(supplyOutputs).toHaveBeenCalledOnce();
});
