// File generated from our OpenAPI spec by Stainless.

import { AbstractPage, Response, APIClient, FinalRequestOptions } from './core';

export interface PageResponse<Item> {
  data: Array<Item>;

  object: string;
}

/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
export class Page<Item> extends AbstractPage<Item> implements PageResponse<Item> {
  object: string;

  data: Array<Item>;

  constructor(client: APIClient, response: Response, body: PageResponse<Item>, options: FinalRequestOptions) {
    super(client, response, body, options);

    this.object = body.object;
    this.data = body.data;
  }

  getPaginatedItems(): Item[] {
    return this.data;
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
