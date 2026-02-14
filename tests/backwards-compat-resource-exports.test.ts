// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { BatchCancelledWebhookEvent, UnwrapWebhookEvent } from '../src/resources/webhooks';
import type { Conversation, ConversationDeletedResource } from '../src/resources/conversations';

const expectType = <T>(_value: T): void => {};

describe('backwards compatibility: resource type exports', () => {
  test('legacy resource paths continue exporting types after resource splitting', () => {
    expectType<UnwrapWebhookEvent | null>(null);
    expectType<BatchCancelledWebhookEvent | null>(null);
    expectType<Conversation | null>(null);
    expectType<ConversationDeletedResource | null>(null);

    expect(true).toBe(true);
  });
});
