// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as CompletionsAPI from 'openai/resources/beta/chat/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this._client);
}

export namespace Chat {
  export import Completions = CompletionsAPI.Completions;
}
