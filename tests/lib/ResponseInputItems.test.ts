import { toResponseInputItem, toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses/responses';

describe('toResponseInputItems', () => {
  test('normalizes mixed response history items', () => {
    const history: Array<ResponseInputItem | ResponseOutputItem> = [
      {
        type: 'function_call_output',
        call_id: 'function_call_123',
        output: 'done',
      },
      {
        type: 'tool_search_call',
        id: 'tool_search_item_123',
        call_id: 'tool_search_call_123',
        arguments: { query: 'schema' },
        execution: 'server',
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'compaction',
        id: 'compaction_123',
        encrypted_content: 'encrypted',
        created_by: 'assistant',
      },
      {
        type: 'shell_call',
        id: 'shell_call_123',
        call_id: 'shell_call_123',
        action: {
          commands: ['pwd'],
          max_output_length: 512,
          timeout_ms: 1000,
        },
        environment: null,
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'shell_call_output',
        id: 'shell_call_output_123',
        call_id: 'shell_call_123',
        max_output_length: 512,
        output: [
          {
            stdout: '/workspace\n',
            stderr: '',
            outcome: { type: 'exit', exit_code: 0 },
            created_by: 'assistant',
          },
        ],
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'apply_patch_call',
        id: 'apply_patch_call_123',
        call_id: 'apply_patch_call_123',
        operation: {
          type: 'create_file',
          path: 'notes.txt',
          diff: 'hello',
        },
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'apply_patch_call_output',
        id: 'apply_patch_call_output_123',
        call_id: 'apply_patch_call_123',
        output: 'created notes.txt',
        status: 'completed',
        created_by: 'assistant',
      },
    ];

    expect(toResponseInputItems(history)).toEqual([
      {
        type: 'function_call_output',
        call_id: 'function_call_123',
        output: 'done',
      },
      {
        type: 'tool_search_call',
        id: 'tool_search_item_123',
        call_id: 'tool_search_call_123',
        arguments: { query: 'schema' },
        execution: 'server',
        status: 'completed',
      },
      {
        type: 'compaction',
        id: 'compaction_123',
        encrypted_content: 'encrypted',
      },
      {
        type: 'shell_call',
        id: 'shell_call_123',
        call_id: 'shell_call_123',
        action: {
          commands: ['pwd'],
          max_output_length: 512,
          timeout_ms: 1000,
        },
        environment: null,
        status: 'completed',
      },
      {
        type: 'shell_call_output',
        id: 'shell_call_output_123',
        call_id: 'shell_call_123',
        max_output_length: 512,
        output: [
          {
            stdout: '/workspace\n',
            stderr: '',
            outcome: { type: 'exit', exit_code: 0 },
          },
        ],
        status: 'completed',
      },
      {
        type: 'apply_patch_call',
        id: 'apply_patch_call_123',
        call_id: 'apply_patch_call_123',
        operation: {
          type: 'create_file',
          path: 'notes.txt',
          diff: 'hello',
        },
        status: 'completed',
      },
      {
        type: 'apply_patch_call_output',
        id: 'apply_patch_call_output_123',
        call_id: 'apply_patch_call_123',
        output: 'created notes.txt',
        status: 'completed',
      },
    ]);
  });

  test('normalizes current output-only fields and omits non-replayable items', () => {
    const history: ResponseOutputItem[] = [
      {
        type: 'function_call_output',
        id: 'function_call_output_123',
        call_id: 'function_call_123',
        output: 'done',
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'computer_call_output',
        id: 'computer_call_output_completed_123',
        call_id: 'computer_call_completed_123',
        output: {
          type: 'computer_screenshot',
          image_url: 'https://example.com/completed.png',
        },
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'computer_call_output',
        id: 'computer_call_output_failed_123',
        call_id: 'computer_call_failed_123',
        output: {
          type: 'computer_screenshot',
          image_url: 'https://example.com/failed.png',
        },
        status: 'failed',
        created_by: 'assistant',
      },
      {
        type: 'custom_tool_call_output',
        id: 'custom_tool_call_output_123',
        call_id: 'custom_tool_call_123',
        output: 'done',
        status: 'completed',
        created_by: 'assistant',
      },
      {
        type: 'custom_tool_call_output',
        id: 'custom_tool_call_output_incomplete_123',
        call_id: 'custom_tool_call_incomplete_123',
        output: 'partial result',
        status: 'incomplete',
        created_by: 'assistant',
      },
      {
        type: 'additional_tools',
        id: 'additional_tools_assistant_123',
        role: 'assistant',
        tools: [],
      },
      {
        type: 'additional_tools',
        id: 'additional_tools_developer_123',
        role: 'developer',
        tools: [],
      },
    ];

    expect(toResponseInputItems(history)).toEqual([
      {
        type: 'function_call_output',
        id: 'function_call_output_123',
        call_id: 'function_call_123',
        output: 'done',
        status: 'completed',
      },
      {
        type: 'computer_call_output',
        id: 'computer_call_output_completed_123',
        call_id: 'computer_call_completed_123',
        output: {
          type: 'computer_screenshot',
          image_url: 'https://example.com/completed.png',
        },
        status: 'completed',
      },
      {
        type: 'custom_tool_call_output',
        id: 'custom_tool_call_output_123',
        call_id: 'custom_tool_call_123',
        output: 'done',
      },
      {
        type: 'additional_tools',
        id: 'additional_tools_developer_123',
        role: 'developer',
        tools: [],
      },
    ]);

    expect(toResponseInputItem(history[2]!)).toBeNull();
    expect(toResponseInputItem(history[4]!)).toBeNull();
    expect(toResponseInputItem(history[5]!)).toBeNull();
    expect(() =>
      toResponseInputItem({ type: 'future_response_item' } as unknown as ResponseOutputItem),
    ).toThrow('Unsupported response item type: future_response_item');
  });
});
