/* oxlint-disable max-classes-per-file -- Both released concrete socket subclasses need the same send compatibility check. */
import { expectTypeOf, test } from 'vitest';
import type {
  ConversationItem,
  ConversationItemCreateEvent,
  RealtimeClientEvent,
  RealtimeResponseCreateParams,
  RealtimeResponseCreateParamsWithReferencesParam,
  ResponseCreateEvent,
  ResponseCreateEventWithReferencesParam,
} from 'openai/resources/realtime/realtime';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';

test('keeps released reader and send signatures while adding request-only reference input', () => {
  interface ExistingItem {
    type: 'item_reference';
    id: string;
  }
  expectTypeOf<RealtimeResponseCreateParams['input']>().toEqualTypeOf<ConversationItem[] | undefined>();
  expectTypeOf<ResponseCreateEvent['response']>().toEqualTypeOf<RealtimeResponseCreateParams | undefined>();
  expectTypeOf<
    Extract<RealtimeClientEvent, { type: 'response.create' }>
  >().toEqualTypeOf<ResponseCreateEvent>();
  expectTypeOf<ExistingItem>().not.toExtend<NonNullable<RealtimeResponseCreateParams['input']>[number]>();
  expectTypeOf<ExistingItem>().not.toExtend<ConversationItemCreateEvent['item']>();
  expectTypeOf<ExistingItem>().toExtend<
    NonNullable<RealtimeResponseCreateParamsWithReferencesParam['input']>[number]
  >();

  expectTypeOf<Parameters<OpenAIRealtimeWS['send']>[0]>().toEqualTypeOf<RealtimeClientEvent>();
  expectTypeOf<Parameters<OpenAIRealtimeWebSocket['send']>[0]>().toEqualTypeOf<RealtimeClientEvent>();
  expectTypeOf<
    Parameters<OpenAIRealtimeWS['sendResponseCreate']>[0]
  >().toEqualTypeOf<ResponseCreateEventWithReferencesParam>();
  expectTypeOf<
    Parameters<OpenAIRealtimeWebSocket['sendResponseCreate']>[0]
  >().toEqualTypeOf<ResponseCreateEventWithReferencesParam>();
});

test('existing socket subclasses can continue to override send with the released event type', () => {
  class WsSubclass extends OpenAIRealtimeWS {
    override send(event: RealtimeClientEvent): void {
      super.send(event);
    }
  }
  class NativeSubclass extends OpenAIRealtimeWebSocket {
    override send(event: RealtimeClientEvent): void {
      super.send(event);
    }
  }
  expectTypeOf<WsSubclass>().toExtend<OpenAIRealtimeWS>();
  expectTypeOf<NativeSubclass>().toExtend<OpenAIRealtimeWebSocket>();
});
