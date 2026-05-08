import type {
  ResponseFunctionShellCallOutputContent,
  ResponseInputItem,
  ResponseOutputItem,
} from '../../resources/responses/responses';

export type ResponseInputItemLike = ResponseInputItem | ResponseOutputItem;

type ResponseShellCallOutputInputItem = Extract<ResponseInputItem, { type: 'shell_call_output' }>;

/**
 * Normalizes a mixed array of stored response history items into clean
 * `ResponseInputItem`s that can be sent back to `responses.create()`.
 */
export function toResponseInputItems(items: Iterable<ResponseInputItemLike>): ResponseInputItem[] {
  return Array.from(items, toResponseInputItem);
}

/**
 * Normalizes a stored response history item into a clean `ResponseInputItem`.
 */
export function toResponseInputItem(item: ResponseInputItemLike): ResponseInputItem {
  switch (item.type) {
    case 'apply_patch_call': {
      return stripCreatedBy(item);
    }

    case 'apply_patch_call_output': {
      return stripCreatedBy(item);
    }

    case 'compaction': {
      return stripCreatedBy(item);
    }

    case 'shell_call': {
      return stripCreatedBy(item);
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

    case 'tool_search_call': {
      return stripCreatedBy(item);
    }

    case 'tool_search_output': {
      return stripCreatedBy(item);
    }

    default:
      return item;
  }
}

function stripCreatedBy<T extends object>(item: T): T {
  if (!('created_by' in item)) {
    return item;
  }

  const { created_by: _createdBy, ...rest } = item as T & { created_by?: string };
  return rest as T;
}
