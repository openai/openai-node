import type { ResponsesEmitter } from '../../resources/responses/internal-base';
import type { ResponsesEmitter as BetaResponsesEmitter } from '../../resources/beta/responses/internal-base';
import type {
  Response,
  ResponsesClientEvent,
  ResponsesServerEvent,
} from '../../resources/responses/responses';
import type {
  BetaResponse,
  BetaResponsesClientEvent,
  BetaResponsesServerEvent,
} from '../../resources/beta/responses/responses';

/** The generated client-event family also selects its server and response models.
 * @internal
 */
export type WebSocketClientEvent = ResponsesClientEvent | BetaResponsesClientEvent;

// Keep the selected values conditional directly: projecting an object profile
// hides the client family's variance when TypeScript compares session instances.
type WebSocketFamily<Client extends WebSocketClientEvent, Stable, Beta> = [Client] extends [
  ResponsesClientEvent,
]
  ? [ResponsesClientEvent] extends [Client]
    ? Stable
    : never
  : [Client] extends [BetaResponsesClientEvent]
    ? [BetaResponsesClientEvent] extends [Client]
      ? Beta
      : never
    : [WebSocketClientEvent] extends [Client]
      ? Stable
      : never;

/** @internal */
export type WebSocketClient<Client extends WebSocketClientEvent> = WebSocketFamily<
  Client,
  ResponsesClientEvent,
  BetaResponsesClientEvent
>;

/** @internal */
export type WebSocketEmitter<Client extends WebSocketClientEvent> = WebSocketFamily<
  Client,
  ResponsesEmitter,
  BetaResponsesEmitter
>;

/** @internal */
export type WebSocketResponse<Client extends WebSocketClientEvent> = WebSocketFamily<
  Client,
  Response,
  BetaResponse
>;

/** Keep the existing stable final type exact; beta adds derived text.
 * @internal
 */
export type WebSocketFinalResponse<Client extends WebSocketClientEvent> = WebSocketFamily<
  Client,
  Response,
  BetaResponse & { output_text: string }
>;

/** @internal */
export type WebSocketWireResponse<Client extends WebSocketClientEvent> = Omit<
  WebSocketResponse<Client>,
  'output' | 'output_text'
> & { output?: WebSocketResponse<Client>['output']; output_text?: string };

type WireEvent<Event, Client extends WebSocketClientEvent> = Event extends { response: unknown }
  ? Omit<Event, 'response'> & { response: WebSocketWireResponse<Client> }
  : Event;

/** @internal */
export type WebSocketWireEvent<Client extends WebSocketClientEvent> = WireEvent<
  WebSocketFamily<Client, ResponsesServerEvent, BetaResponsesServerEvent>,
  Client
>;
