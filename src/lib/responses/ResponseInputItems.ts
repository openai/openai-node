import type {
  ResponseFunctionShellCallOutputContent,
  ResponseInputItem,
  ResponseOutputItem,
} from '../../resources/responses/responses';

export type ResponseInputItemLike = ResponseInputItem | ResponseOutputItem;

type ResponseShellCallOutputInputItem = Extract<ResponseInputItem, { type: 'shell_call_output' }>;
type ResponseComputerCallOutputInputItem = Extract<ResponseInputItem, { type: 'computer_call_output' }>;
type ResponseCustomToolCallOutputInputItem = Extract<ResponseInputItem, { type: 'custom_tool_call_output' }>;
type ResponseAdditionalToolsInputItem = Extract<ResponseInputItem, { type: 'additional_tools' }>;

/**
 * Normalizes a mixed array of stored response history items into clean
 * `ResponseInputItem`s that can be sent back to `responses.create()`. Known items
 * that cannot be replayed without changing their meaning are omitted.
 *
 * @throws {TypeError} If an item type is not supported by the installed SDK.
 */
export function toResponseInputItems(items: Iterable<ResponseInputItemLike>): ResponseInputItem[] {
  const inputItems: ResponseInputItem[] = [];
  for (const item of items) {
    const inputItem = toResponseInputItem(item);
    if (inputItem) {
      inputItems.push(inputItem);
    }
  }
  return inputItems;
}

/**
 * Normalizes a stored response history item into a clean `ResponseInputItem`, or
 * returns `null` when a known item cannot be replayed without changing its
 * meaning.
 *
 * @throws {TypeError} If the item type is not supported by the installed SDK.
 */
export function toResponseInputItem(item: ResponseInputItemLike): ResponseInputItem | null {
  switch (item.type) {
    case 'additional_tools': {
      if (item.role !== 'developer') {
        return null;
      }
      return stripCreatedBy(item) as ResponseAdditionalToolsInputItem;
    }

    case 'shell_call_output': {
      const output: ResponseShellCallOutputInputItem['output'] = item.output.map(
        (chunk) => stripCreatedBy(chunk) as ResponseFunctionShellCallOutputContent,
      );
      return {
        ...(stripCreatedBy(item) as ResponseShellCallOutputInputItem),
        output,
      };
    }

    case 'computer_call_output': {
      const { created_by: _createdBy, ...withoutCreatedBy } = item as typeof item & {
        created_by?: string;
      };
      if (withoutCreatedBy.status === 'failed') {
        return null;
      }
      return withoutCreatedBy as ResponseComputerCallOutputInputItem;
    }

    case 'custom_tool_call_output': {
      if ('status' in item && item.status !== 'completed') {
        return null;
      }
      const {
        created_by: _createdBy,
        status: _status,
        ...inputItem
      } = item as typeof item & { created_by?: string; status?: string };
      return inputItem as ResponseCustomToolCallOutputInputItem;
    }

    case 'apply_patch_call':
    case 'apply_patch_call_output':
    case 'code_interpreter_call':
    case 'compaction':
    case 'compaction_trigger':
    case 'computer_call':
    case 'custom_tool_call':
    case 'file_search_call':
    case 'function_call':
    case 'function_call_output':
    case 'image_generation_call':
    case 'item_reference':
    case 'local_shell_call':
    case 'local_shell_call_output':
    case 'mcp_approval_request':
    case 'mcp_approval_response':
    case 'mcp_call':
    case 'mcp_list_tools':
    case 'message':
    case 'reasoning':
    case 'shell_call':
    case 'tool_search_call':
    case 'tool_search_output':
    case 'web_search_call':
    case null:
    case undefined: {
      return stripCreatedBy(item) as ResponseInputItem;
    }

    default: {
      return assertNever(item);
    }
  }
}

function stripCreatedBy<T extends object>(item: T): T {
  if (!('created_by' in item)) {
    return item;
  }

  const { created_by: _createdBy, ...rest } = item as T & { created_by?: string };
  return rest as T;
}

function assertNever(value: never): never {
  const type = (value as { type?: unknown }).type;
  throw new TypeError(`Unsupported response item type: ${String(type)}`);
}
