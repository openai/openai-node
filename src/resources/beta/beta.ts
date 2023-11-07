// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as AssistantsAPI from 'openai/resources/beta/assistants/assistants';
import * as ChatAPI from 'openai/resources/beta/chat/chat';
import * as ThreadsAPI from 'openai/resources/beta/threads/threads';

export class Beta extends APIResource {
  chat: ChatAPI.Chat = new ChatAPI.Chat(this.client);
  assistants: AssistantsAPI.Assistants = new AssistantsAPI.Assistants(this.client);
  threads: ThreadsAPI.Threads = new ThreadsAPI.Threads(this.client);
}

export namespace Beta {
  export import Chat = ChatAPI.Chat;
  export import Assistants = AssistantsAPI.Assistants;
  export import Assistant = AssistantsAPI.Assistant;
  export import AssistantDeleted = AssistantsAPI.AssistantDeleted;
  export import AssistantsPage = AssistantsAPI.AssistantsPage;
  export import AssistantCreateParams = AssistantsAPI.AssistantCreateParams;
  export import AssistantUpdateParams = AssistantsAPI.AssistantUpdateParams;
  export import AssistantListParams = AssistantsAPI.AssistantListParams;
  export import Threads = ThreadsAPI.Threads;
  export import Thread = ThreadsAPI.Thread;
  export import ThreadDeleted = ThreadsAPI.ThreadDeleted;
  export import ThreadCreateParams = ThreadsAPI.ThreadCreateParams;
  export import ThreadUpdateParams = ThreadsAPI.ThreadUpdateParams;
  export import ThreadCreateAndRunParams = ThreadsAPI.ThreadCreateAndRunParams;
}
