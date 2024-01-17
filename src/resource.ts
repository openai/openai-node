// File generated from our OpenAPI spec by Stainless.

import type { OpenAI } from './index';

export class APIResource {
  protected _client: OpenAI;

  constructor(client: OpenAI) {
    this._client = client;
  }
}
