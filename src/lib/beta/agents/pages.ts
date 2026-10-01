import { OpenAIError } from '../../../core/error';
import type { CursorPage } from '../../../core/pagination';
import { isObj } from '../../../internal/utils/values';

/** Retain server cursor metadata for legacy Agents items with nullable IDs.
 * @internal
 * @yields {T} Each item in server order, failing if pagination cannot advance.
 */
export async function* agentItems<T extends { id?: string | null }>(
  load: (after: string | undefined) => PromiseLike<CursorPage<T>>,
): AsyncGenerator<T, void, undefined> {
  let after: string | undefined;
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- Each page determines the next cursor.
    const page = await load(after);
    yield* page.data;
    if (!page.has_more) {
      return;
    }
    // Internal SDK read: CursorPage keeps raw metadata but does not expose last_id.
    // oxlint-disable-next-line prefer-destructuring -- Bracket access intentionally reads a protected internal field.
    const body = page['body'];
    // oxlint-disable-next-line unicorn/prefer-at -- Keep published source compatible with ES2020 declarations.
    const last = page.data[page.data.length - 1];
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate only the opaque cursor from response metadata.
    const cursor = isObj(body) && typeof body['last_id'] === 'string' ? body['last_id'] : last?.id;
    if (!cursor || cursor === after) {
      throw new OpenAIError('Agent pagination cannot advance to the next page');
    }
    after = cursor;
  }
}
