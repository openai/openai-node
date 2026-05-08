import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses';

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
});
