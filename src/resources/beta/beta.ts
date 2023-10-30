// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as ChatAPI from 'openai/resources/beta/chat/chat';

export class Beta extends APIResource {
  chat: ChatAPI.Chat = new ChatAPI.Chat(this.client);
}

export namespace Beta {
  export import Chat = ChatAPI.Chat;
}
