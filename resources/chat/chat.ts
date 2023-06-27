// File generated from our OpenAPI spec by Stainless.

import { APIResource } from '~/resource';
import { Completions } from './completions';
import * as API from './';

export class Chat extends APIResource {
  completions: Completions = new Completions(this.client);
}

export namespace Chat {
  export import Completions = API.Completions;
  export import ChatCompletion = API.ChatCompletion;
  export import ChatCompletionChunk = API.ChatCompletionChunk;
  export import CompletionCreateParams = API.CompletionCreateParams;
}
