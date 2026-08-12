import type { OpenAI } from '../client';

export abstract class APIResource {
  protected _client: OpenAI;

  constructor(client: OpenAI) {
    this._client = client;
  }
}
