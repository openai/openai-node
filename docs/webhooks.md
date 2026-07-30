# Webhooks

The SDK verifies that an incoming webhook was sent by OpenAI before parsing or processing its payload.
Set `OPENAI_WEBHOOK_SECRET`, or pass `webhookSecret` when constructing the client:

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  webhookSecret: process.env['OPENAI_WEBHOOK_SECRET'],
});
```

Webhook verification is asynchronous. Always `await` `unwrap()` or `verifySignature()` before trusting
the event.

## Verify and parse an event

`client.webhooks.unwrap()` verifies the signature and then parses the original JSON payload into a typed
event. Read the request as text: parsing and reserializing JSON can change the bytes that were signed.

```ts
import OpenAI, { InvalidWebhookSignatureError } from 'openai';

const client = new OpenAI();

export async function POST(request: Request) {
  const body = await request.text();

  try {
    const event = await client.webhooks.unwrap(body, request.headers);

    switch (event.type) {
      case 'response.completed':
        console.log('Response completed:', event.data);
        break;
      case 'response.failed':
        console.log('Response failed:', event.data);
        break;
      default:
        console.log('Unhandled event:', event.type);
    }

    return new Response('ok', { status: 200 });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return new Response('Invalid webhook signature', { status: 400 });
    }

    console.error('Webhook handling failed:', error);
    return new Response('Webhook handling failed', { status: 400 });
  }
}
```

The client also reads its webhook secret from `OPENAI_WEBHOOK_SECRET` when no `webhookSecret` option is
provided.

## Verify before parsing manually

Use `verifySignature()` when parsing, validating, or routing the payload yourself. It returns a promise
that must settle successfully before the payload is processed:

```ts
export async function POST(request: Request) {
  const body = await request.text();

  try {
    await client.webhooks.verifySignature(body, request.headers);
    const event = JSON.parse(body);

    await handleEvent(event);
    return new Response('ok', { status: 200 });
  } catch (error) {
    console.error('Webhook verification failed:', error);
    return new Response('Invalid webhook', { status: 400 });
  }
}
```

Calling `verifySignature()` without `await` lets subsequent code run before verification finishes and
prevents the surrounding `try`/`catch` from catching asynchronous verification failures.

## Secrets and timestamp tolerance

Both methods accept an optional explicit secret and timestamp tolerance:

```ts
const secret = process.env['ROTATED_WEBHOOK_SECRET'];

if (!secret) {
  throw new Error('Missing rotated webhook secret');
}

await client.webhooks.verifySignature(
  rawBody,
  request.headers,
  secret,
  600, // Accept timestamps within 10 minutes.
);
```

The default tolerance is 300 seconds. Timestamp validation rejects events that are too far in the past
or future, so keep the receiving server's clock synchronized. Verification also requires the
`webhook-id`, `webhook-timestamp`, and `webhook-signature` headers and a runtime with Web Crypto.

## Framework integration

Read the unmodified request body before any JSON middleware consumes it. With a standard Web API
`Request`, call `await request.text()` and pass `request.headers`. In frameworks that parse request
bodies automatically, configure the webhook route to retain the raw text and original request headers.

See the [generated Webhooks API reference](../src/resources/webhooks/api.md) and the
[OpenAI webhook guide](https://platform.openai.com/docs/guides/webhooks).
