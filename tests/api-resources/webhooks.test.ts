// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource webhooks', () => {
  // all this data is taken from a real webhook event
  const payload = `{"id": "evt_685c059ae3a481909bdc86819b066fb6", "object": "event", "created_at": 1750861210, "type": "response.completed", "data": {"id": "resp_123"}}`;
  const webhookSignature = 'v1,gUAg4R2hWouRZqRQG4uJypNS8YK885G838+EHb4nKBY=';
  const testTimestamp = 1750861210;
  const webhookTimestamp = testTimestamp.toString();
  const webhookId = 'wh_685c059ae39c8190af8c71ed1022a24d';
  const headers = new Headers({
    'webhook-signature': webhookSignature,
    'webhook-timestamp': webhookTimestamp,
    'webhook-id': webhookId,
  });
  const secret = 'whsec_RdvaYFYUXuIFuEbvZHwMfYFhUf7aMYjYcmM24+Aj40c=';

  // Mock time to match our test timestamp
  const mockNow = testTimestamp * 1000; // Convert to milliseconds

  beforeEach(() => {
    jest.spyOn(global.Date, 'now').mockImplementation(() => mockNow);
  });

  afterEach(() => {
    // restore the spy created with spyOn
    jest.restoreAllMocks();
  });

  describe('unwrap', () => {
    it('deserializes the payload object', async () => {
      const unwrapped = await client.webhooks.unwrap(payload, headers, secret);

      expect(unwrapped).toEqual({
        id: 'evt_685c059ae3a481909bdc86819b066fb6',
        object: 'event',
        created_at: 1750861210,
        type: 'response.completed',
        data: { id: 'resp_123' },
      });
    });
  });

  describe('verifySignature', () => {
    it('should pass for valid signature', async () => {
      await client.webhooks.verifySignature(payload, headers, secret);
    });

    it('should throw an error for invalid secret format', async () => {
      await expect(
        client.webhooks.verifySignature(payload, headers, null as any),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function"`,
      );
    });

    it('should throw for invalid signature', async () => {
      await expect(
        client.webhooks.verifySignature(payload, headers, Buffer.from('foo').toString('base64')),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The given webhook signature does not match the expected signature"`,
      );
    });

    it('should throw for missing webhook-signature header', async () => {
      const incompleteHeaders = new Headers({
        'webhook-timestamp': webhookTimestamp,
        'webhook-id': webhookId,
      });

      await expect(
        client.webhooks.verifySignature(payload, incompleteHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Missing required header: webhook-signature"`);
    });

    it('should throw for missing webhook-timestamp header', async () => {
      const incompleteHeaders = new Headers({
        'webhook-signature': webhookSignature,
        'webhook-id': webhookId,
      });

      await expect(
        client.webhooks.verifySignature(payload, incompleteHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Missing required header: webhook-timestamp"`);
    });

    it('should throw for missing webhook-id header', async () => {
      const incompleteHeaders = new Headers({
        'webhook-signature': webhookSignature,
        'webhook-timestamp': webhookTimestamp,
      });

      await expect(
        client.webhooks.verifySignature(payload, incompleteHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Missing required header: webhook-id"`);
    });

    it('should throw if payload is not a string', async () => {
      await expect(
        client.webhooks.verifySignature({ payload: 'not a string' } as any, headers, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The given webhook signature does not match the expected signature"`,
      );
    });

    it('should throw for timestamp too old', async () => {
      // Create a timestamp that is older than 5 minutes from our mocked "now" time
      const oldTimestamp = (testTimestamp - 400).toString(); // 6 minutes 40 seconds ago
      const oldHeaders = new Headers({
        'webhook-signature': 'v1,dummy_signature',
        'webhook-timestamp': oldTimestamp,
        'webhook-id': webhookId,
      });

      await expect(
        client.webhooks.verifySignature(payload, oldHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Webhook timestamp is too old"`);
    });

    it('should throw for timestamp too new', async () => {
      // Create a timestamp that is in the future beyond tolerance
      const futureTimestamp = (testTimestamp + 400).toString(); // 6 minutes 40 seconds in the future
      const futureHeaders = new Headers({
        'webhook-signature': 'v1,dummy_signature',
        'webhook-timestamp': futureTimestamp,
        'webhook-id': webhookId,
      });

      await expect(
        client.webhooks.verifySignature(payload, futureHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Webhook timestamp is too new"`);
    });

    it('should throw for invalid timestamp format', async () => {
      const invalidHeaders = new Headers({
        'webhook-signature': webhookSignature,
        'webhook-timestamp': 'not-a-number',
        'webhook-id': webhookId,
      });

      await expect(
        client.webhooks.verifySignature(payload, invalidHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Invalid webhook timestamp format"`);
    });

    it('should pass with custom tolerance', async () => {
      // Create a timestamp that would normally be too old with default tolerance
      const oldTimestamp = (testTimestamp - 400).toString(); // 6 minutes 40 seconds ago
      const oldHeaders = new Headers({
        'webhook-signature': 'v1,dummy_signature',
        'webhook-timestamp': oldTimestamp,
        'webhook-id': webhookId,
      });

      // Should fail with default tolerance
      await expect(
        client.webhooks.verifySignature(payload, oldHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Webhook timestamp is too old"`);

      // Should still fail with custom tolerance of 10 minutes because signature won't match
      await expect(
        client.webhooks.verifySignature(payload, oldHeaders, secret, 600),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The given webhook signature does not match the expected signature"`,
      );
    });

    it('should pass for multiple signatures when one is valid', async () => {
      // Test multiple signatures: one invalid, one valid
      const multipleSignatures = `v1,invalid_signature ${webhookSignature}`;
      const multipleHeaders = new Headers({
        'webhook-signature': multipleSignatures,
        'webhook-timestamp': webhookTimestamp,
        'webhook-id': webhookId,
      });

      // Should not throw when at least one signature is valid
      await client.webhooks.verifySignature(payload, multipleHeaders, secret);
    });

    it('should throw for multiple signatures when all are invalid', async () => {
      // Test multiple invalid signatures
      const multipleInvalidSignatures = 'v1,invalid_signature1 v1,invalid_signature2';
      const multipleHeaders = new Headers({
        'webhook-signature': multipleInvalidSignatures,
        'webhook-timestamp': webhookTimestamp,
        'webhook-id': webhookId,
      });

      await expect(
        client.webhooks.verifySignature(payload, multipleHeaders, secret),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"The given webhook signature does not match the expected signature"`,
      );
    });
  });
});
