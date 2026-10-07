import { hasOwn, isObj } from '../../../internal/utils/values';
import type { InputContentParam } from '../../../resources/beta/agents/agents';

/**
 * Recognizes supported content blocks without confusing JSON business data with content.
 * @internal
 */
export function isInputContent(value: unknown): value is InputContentParam {
  if (!isObj(value)) {
    return false;
  }
  const content = value;
  let field: string;
  if (content['type'] === 'input_text') {
    field = 'text';
  } else if (content['type'] === 'input_image') {
    field = 'image_url';
  } else {
    return false;
  }
  return hasOwn(content, 'type') && hasOwn(content, field) && typeof content[field] === 'string';
}
