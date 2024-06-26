// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { OpenAI, Response, OpenAIError } from './index';
import { FinalRequestOptions } from './internal/request-options';
import { defaultParseResponse, APIResponseProps } from 'openai/internal/parse';
import { APIPromise } from './internal/api-promise';

export type PageInfo = { url: URL } | { params: Record<string, unknown> | null };

export abstract class AbstractPage<Item> implements AsyncIterable<Item> {
  #client: OpenAI;
  protected options: FinalRequestOptions;

  protected response: Response;
  protected body: unknown;

  constructor(client: OpenAI, response: Response, body: unknown, options: FinalRequestOptions) {
    this.#client = client;
    this.options = options;
    this.response = response;
    this.body = body;
  }

  /**
   * @deprecated Use nextPageInfo instead
   */
  abstract nextPageParams(): Partial<Record<string, unknown>> | null;
  abstract nextPageInfo(): PageInfo | null;

  abstract getPaginatedItems(): Item[];

  hasNextPage(): boolean {
    const items = this.getPaginatedItems();
    if (!items.length) return false;
    return this.nextPageInfo() != null;
  }

  async getNextPage(): Promise<this> {
    const nextInfo = this.nextPageInfo();
    if (!nextInfo) {
      throw new OpenAIError(
        'No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.',
      );
    }
    const nextOptions = { ...this.options };
    if ('params' in nextInfo && typeof nextOptions.query === 'object') {
      nextOptions.query = { ...nextOptions.query, ...nextInfo.params };
    } else if ('url' in nextInfo) {
      const params = [...Object.entries(nextOptions.query || {}), ...nextInfo.url.searchParams.entries()];
      for (const [key, value] of params) {
        nextInfo.url.searchParams.set(key, value as any);
      }
      nextOptions.query = undefined;
      nextOptions.path = nextInfo.url.toString();
    }
    return await this.#client.requestAPIList(this.constructor as any, nextOptions);
  }

  async *iterPages() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let page: AbstractPage<Item> = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }

  async *[Symbol.asyncIterator]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
}

/**
 * This subclass of Promise will resolve to an instantiated Page once the request completes.
 *
 * It also implements AsyncIterable to allow auto-paginating iteration on an unawaited list call, eg:
 *
 *    for await (const item of client.items.list()) {
 *      console.log(item)
 *    }
 */
export class PagePromise<
    PageClass extends AbstractPage<Item>,
    Item = ReturnType<PageClass['getPaginatedItems']>[number],
  >
  extends APIPromise<PageClass>
  implements AsyncIterable<Item>
{
  constructor(
    client: OpenAI,
    request: Promise<APIResponseProps>,
    Page: new (...args: ConstructorParameters<typeof AbstractPage>) => PageClass,
  ) {
    super(
      request,
      async (props) => new Page(client, props.response, await defaultParseResponse(props), props.options),
    );
  }

  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
}

export interface PageResponse<Item> {
  data: Array<Item>;

  object: string;
}

/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
export class Page<Item> extends AbstractPage<Item> implements PageResponse<Item> {
  data: Array<Item>;

  object: string;

  constructor(client: OpenAI, response: Response, body: PageResponse<Item>, options: FinalRequestOptions) {
    super(client, response, body, options);

    this.data = body.data || [];
    this.object = body.object;
  }

  getPaginatedItems(): Item[] {
    return this.data ?? [];
  }

  // @deprecated Please use `nextPageInfo()` instead
  /**
   * This page represents a response that isn't actually paginated at the API level
   * so there will never be any next page params.
   */
  nextPageParams(): null {
    return null;
  }

  nextPageInfo(): null {
    return null;
  }
}

export interface CursorPageResponse<Item> {
  data: Array<Item>;
}

export interface CursorPageParams {
  after?: string;

  limit?: number;
}

export class CursorPage<Item extends { id: string }>
  extends AbstractPage<Item>
  implements CursorPageResponse<Item>
{
  data: Array<Item>;

  constructor(
    client: OpenAI,
    response: Response,
    body: CursorPageResponse<Item>,
    options: FinalRequestOptions,
  ) {
    super(client, response, body, options);

    this.data = body.data || [];
  }

  getPaginatedItems(): Item[] {
    return this.data ?? [];
  }

  // @deprecated Please use `nextPageInfo()` instead
  nextPageParams(): Partial<CursorPageParams> | null {
    const info = this.nextPageInfo();
    if (!info) return null;
    if ('params' in info) return info.params;
    const params = Object.fromEntries(info.url.searchParams);
    if (!Object.keys(params).length) return null;
    return params;
  }

  nextPageInfo(): PageInfo | null {
    const data = this.getPaginatedItems();
    if (!data.length) {
      return null;
    }

    const id = data[data.length - 1]?.id;
    if (!id) {
      return null;
    }

    return { params: { after: id } };
  }
}
