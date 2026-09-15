import type {
  ResponseFunctionShellCallOutputContent,
  ResponseInputItem,
  ResponseOutputItem,
} from '../../resources/responses/responses';

/** A stored response input or output item that may be normalized for a later request. */
export type ResponseInputItemLike = ResponseInputItem | ResponseOutputItem;

type ResponseShellCallOutputInputItem = Extract<ResponseInputItem, { type: 'shell_call_output' }>;
type ResponseComputerCallOutputInputItem = Extract<ResponseInputItem, { type: 'computer_call_output' }>;
type ResponseCustomToolCallOutputInputItem = Extract<ResponseInputItem, { type: 'custom_tool_call_output' }>;
type ResponseAdditionalToolsInputItem = Extract<ResponseInputItem, { type: 'additional_tools' }>;

/**
 * Normalizes a mixed array of stored response history items into clean
 * `ResponseInputItem`s that can be sent back to `responses.create()`. Known items
 * that cannot be replayed without changing their meaning are omitted. SDK-only
 * parsed values are removed without changing the stored items.
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
 * meaning. SDK-only parsed values are removed without changing the stored item.
 *
 * @throws {TypeError} If the item type is not supported by the installed SDK.
 */
export function toResponseInputItem(item: ResponseInputItemLike): ResponseInputItem | null {
  switch (item.type) {
    case 'message': {
      if (item.role !== 'assistant' || !('id' in item) || !Array.isArray(item.content)) {
        return stripCreatedBy(item);
      }
      const content = item.content.map((part) => {
        if ((part.type === 'output_text' || part.type === 'refusal') && 'parsed' in part) {
          const { parsed: _parsed, ...inputPart } = part;
          return inputPart;
        }
        return part;
      });
      if (content.every((part, index) => part === item.content[index])) {
        return stripCreatedBy(item);
      }
      return { ...stripCreatedBy(item), content };
    }

    case 'function_call': {
      const inputItem = stripCreatedBy(item);
      if (!('parsed_arguments' in inputItem)) {
        return inputItem;
      }
      const { parsed_arguments: _parsedArguments, ...withoutParsedArguments } = inputItem;
      return withoutParsedArguments;
    }

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
    case 'configuration_update':
    case 'custom_tool_call':
    case 'file_search_call':
    case 'function_call_output':
    case 'image_generation_call':
    case 'item_reference':
    case 'local_shell_call':
    case 'local_shell_call_output':
    case 'mcp_approval_request':
    case 'mcp_approval_response':
    case 'mcp_call':
    case 'mcp_list_tools':
    case 'program':
    case 'program_output':
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
