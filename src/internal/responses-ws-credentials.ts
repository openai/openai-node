import { WebSocketCredentials } from './ws-credentials';

/** Preserves the stable and beta Responses credential helper's constructor. */
export class ResponsesWebSocketCredentials extends WebSocketCredentials {
  constructor() {
    super('Responses');
  }
}
