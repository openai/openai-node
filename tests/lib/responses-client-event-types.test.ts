import { expectTypeOf, test } from 'vitest';
import type { Responses, ResponsesClientEvent } from 'openai/resources/responses/responses';

test('preserves the legacy response.create helper type names', () => {
  expectTypeOf<ResponsesClientEvent.ContextManagement>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.ContextManagement>();
  expectTypeOf<ResponsesClientEvent.Moderation>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.Moderation>();
  expectTypeOf<ResponsesClientEvent.Moderation.Policy>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.Moderation.Policy>();
  expectTypeOf<ResponsesClientEvent.Moderation.Policy.Input>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.Moderation.Policy.Input>();
  expectTypeOf<ResponsesClientEvent.Moderation.Policy.Output>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.Moderation.Policy.Output>();
  expectTypeOf<ResponsesClientEvent.PromptCacheOptions>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.PromptCacheOptions>();
  expectTypeOf<ResponsesClientEvent.StreamOptions>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.StreamOptions>();
  expectTypeOf<ResponsesClientEvent.SpecificProgrammaticToolCallingParam>().toEqualTypeOf<ResponsesClientEvent.ResponseCreate.SpecificProgrammaticToolCallingParam>();
  expectTypeOf<Responses.ResponsesClientEvent.ContextManagement>().toEqualTypeOf<ResponsesClientEvent.ContextManagement>();
});
