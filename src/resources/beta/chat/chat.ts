// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'martian-node/resource';
import * as CompletionsAPI from 'martian-node/resources/beta/chat/completions';

export class Chat extends APIResource {
  completions: CompletionsAPI.Completions = new CompletionsAPI.Completions(this._client);
}

export namespace Chat {
  export import Completions = CompletionsAPI.Completions;
}
