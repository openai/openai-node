import { expectTypeOf, test } from 'vitest';
import type { Response, ResponsesClientEvent } from 'openai/resources/responses/responses';
import type { BetaResponse, BetaResponsesClientEvent } from 'openai/resources/beta/responses/responses';
import type { ResponsesWS } from 'openai/resources/responses/ws';
import type { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import type { ResponsesEmitter } from 'openai/resources/responses/internal-base';
import type { ResponsesWSBase } from 'openai/resources/responses/ws-base';
import type { ResponsesWSBase as BetaResponsesWSBase } from 'openai/resources/beta/responses/ws-base';
import type { ResponsesWebSocketLane } from 'openai/lib/responses/responses-websocket-session';
import { ResponsesWebSocketSession } from 'openai/lib/responses/responses-websocket-session';

type WebSocketLike = ConstructorParameters<typeof ResponsesWebSocketSession>[0]['socket'];

type Client = ResponsesClientEvent | BetaResponsesClientEvent;
type Create<C extends Client> = Parameters<ResponsesWebSocketLane<C>['create']>[0];
type Final<C extends Client> = Awaited<ReturnType<ResponsesWebSocketLane<C>['finalResponse']>>;
type Raw<C extends Client> = Awaited<ReturnType<ResponsesWebSocketLane<C>['receive']>>;
type StableConnection = ResponsesEmitter & { readonly socket: WebSocketLike };
interface WideStable extends ResponsesWS {
  send: (event: unknown) => void;
}
interface WideBeta extends BetaResponsesWS {
  send: (event: unknown) => void;
}

// Compile these public calls without opening connections or executing requests.
async function publicTypes(
  stableConnection: ResponsesWS,
  betaConnection: BetaResponsesWS,
  customStable: StableConnection,
  stableCustomTransport: ResponsesWSBase<WebSocketLike>,
  betaCustomTransport: BetaResponsesWSBase<WebSocketLike>,
  ambiguous: ResponsesWS | BetaResponsesWS,
  betaModel: BetaResponse,
  wideStable: WideStable,
  wideBeta: WideBeta,
) {
  const limits = { maxLanes: 2, maxBufferedEvents: 8, maxBufferedBytes: 4096 };
  const stableSession = new ResponsesWebSocketSession(stableConnection, limits);
  const betaSession = new ResponsesWebSocketSession(betaConnection, limits);
  const stable = stableSession.lane();
  const beta = betaSession.lane();
  const existingSession: ResponsesWebSocketSession = stableSession;
  const existingLane: ResponsesWebSocketLane = stable;
  const customSession: ResponsesWebSocketSession = new ResponsesWebSocketSession(customStable, limits);
  const wideSession: ResponsesWebSocketSession = new ResponsesWebSocketSession(wideStable, limits);
  const explicitWideBeta = new ResponsesWebSocketSession<BetaResponsesClientEvent>(wideBeta, limits);
  const stableTransport = new ResponsesWebSocketSession(stableCustomTransport, limits).lane();
  const betaTransport = new ResponsesWebSocketSession(betaCustomTransport, limits).lane();
  const reflectedArgs: ConstructorParameters<typeof ResponsesWebSocketSession> = [stableConnection, limits];
  const reflected: InstanceType<typeof ResponsesWebSocketSession> = stableSession;
  const reflectedDefault: ResponsesWebSocketSession = reflected;
  const explicitStable = new ResponsesWebSocketSession<ResponsesClientEvent>(stableConnection, limits);
  const explicitDefault: ResponsesWebSocketSession = explicitStable;
  const defaultExplicit: ResponsesWebSocketSession<ResponsesClientEvent> = stableSession;
  const reflectedFinal: Promise<Response> = reflected.lane().finalResponse();
  const betaArgs: ConstructorParameters<typeof ResponsesWebSocketSession<BetaResponsesClientEvent>> = [
    betaConnection,
    limits,
  ];
  const reflectedBeta: InstanceType<typeof ResponsesWebSocketSession<BetaResponsesClientEvent>> = betaSession;
  class LegacyStableSession extends ResponsesWebSocketSession {}
  const legacySubclass = new LegacyStableSession(stableConnection, limits);
  const subclassDefault: ResponsesWebSocketSession = legacySubclass;
  const subclassFinal: Promise<Response> = legacySubclass.lane().finalResponse();
  const stableOnly: Create<ResponsesClientEvent> = { tool_choice: { type: 'mcp' } };
  const common = { input: 'fixture' };
  stable.create(stableOnly);
  stableTransport.create(stableOnly);
  stable.create(common);
  beta.create(common);
  beta.create({ tool_choice: { type: 'mcp', server_label: 'fixture' } });
  betaTransport.create({ tool_choice: { type: 'mcp', server_label: 'fixture' } });
  // @ts-expect-error This named stable request lacks beta's required server_label.
  beta.create(stableOnly);
  const betaOnly: Create<BetaResponsesClientEvent> = {
    input: [
      {
        type: 'agent_message',
        author: 'fixture_sender',
        recipient: 'fixture_receiver',
        content: [{ type: 'input_text', text: 'fixture' }],
      },
    ],
  };
  beta.create(betaOnly);
  // @ts-expect-error This named beta request includes a beta-only item family.
  stable.create(betaOnly);
  // @ts-expect-error Reflection retains stable request permissions.
  reflected.lane().create(betaOnly);
  // @ts-expect-error Reflection does not admit beta instances as stable.
  const wrongReflected: InstanceType<typeof ResponsesWebSocketSession> = betaSession;
  // @ts-expect-error The stable reflection view must not acquire a beta contract.
  const wrongBetaReflection: ResponsesWebSocketSession<BetaResponsesClientEvent> = reflected;
  // @ts-expect-error A mixed connection must be narrowed first.
  const unsafeMixed = new ResponsesWebSocketSession(ambiguous, limits);
  // @ts-expect-error Explicit broad client families must not widen requests.
  const unsafeBroad = new ResponsesWebSocketSession<Client>(betaConnection, limits);
  // @ts-expect-error A beta session does not have the stable request/final contract.
  const wrongStableSession: ResponsesWebSocketSession = betaSession;
  // @ts-expect-error A beta lane does not have the stable request/final contract.
  const wrongStableLane: ResponsesWebSocketLane = beta;
  // @ts-expect-error A broad session must not discard its concrete family.
  const broadSession: ResponsesWebSocketSession<Client> = betaSession;
  // @ts-expect-error A broad lane must not discard its concrete family.
  const broadLane: ResponsesWebSocketLane<Client> = beta;
  // @ts-expect-error A stable session must not gain beta requests or models.
  const wrongBetaSession: ResponsesWebSocketSession<BetaResponsesClientEvent> = stableSession;
  // @ts-expect-error A stable lane must not gain beta requests or models.
  const wrongBetaLane: ResponsesWebSocketLane<BetaResponsesClientEvent> = stable;
  const stableFinal: Response = await stable.finalResponse();
  const betaFinal: BetaResponse & { output_text: string } = await beta.finalResponse();
  // @ts-expect-error Beta instructions/output cannot be promised as a stable model.
  const wrongStableFinal: Response = betaFinal;
  // @ts-expect-error Stable tool-choice metadata is not a beta model contract.
  const wrongBetaFinal: BetaResponse = stableFinal;
  const { output: omitted, ...metadata } = betaModel;
  const terminal: Extract<Raw<BetaResponsesClientEvent>, { type: 'response.completed' }> = {
    type: 'response.completed',
    sequence_number: 0,
    response: metadata,
  };
  const betaInstructions: BetaResponse['instructions'] = terminal.response.instructions;
  // @ts-expect-error Known beta wire metadata retains the beta model family.
  const wrongInstructions: Response['instructions'] = terminal.response.instructions;
  // @ts-expect-error Omitted wire output is unavailable until final normalization.
  const prematureFinal: Final<BetaResponsesClientEvent> = terminal.response;
  // @ts-expect-error A wide beta sender must never silently select the stable family.
  const unsafeWideBeta: ResponsesWebSocketSession = new ResponsesWebSocketSession(wideBeta, limits);
  // @ts-expect-error The beta emitter does not satisfy the stable emitter family.
  const wrongEmitter: StableConnection = wideBeta;
  // @ts-expect-error Explicit beta types cannot bind a stable emitter family.
  const unsafeExplicit = new ResponsesWebSocketSession<BetaResponsesClientEvent>(wideStable, limits);
  void [
    reflectedArgs,
    reflectedDefault,
    explicitDefault,
    defaultExplicit,
    reflectedFinal,
    betaArgs,
    reflectedBeta,
    subclassDefault,
    subclassFinal,
    wrongReflected,
    wrongBetaReflection,
    unsafeMixed,
    unsafeBroad,
    unsafeExplicit,
    existingSession,
    existingLane,
    customSession,
    wideSession,
    explicitWideBeta,
    wrongStableSession,
    wrongStableLane,
    broadSession,
    broadLane,
    wrongBetaSession,
    wrongBetaLane,
    wrongStableFinal,
    wrongBetaFinal,
    omitted,
    betaInstructions,
    wrongInstructions,
    prematureFinal,
    unsafeWideBeta,
    wrongEmitter,
  ];
}

test('preserves stable defaults and selects the beta response model', () => {
  expectTypeOf(publicTypes).toBeFunction();
  expectTypeOf<Final<ResponsesClientEvent>>().toEqualTypeOf<Response>();
  expectTypeOf<Final<BetaResponsesClientEvent>>().toEqualTypeOf<BetaResponse & { output_text: string }>();
});
