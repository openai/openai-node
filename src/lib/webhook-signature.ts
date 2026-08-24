import { InvalidWebhookSignatureError } from '../error';
import { fromBase64 } from '../internal/utils/base64';
import { encodeUTF8 } from '../internal/utils/bytes';

/**
 * Checks the timestamp and HMAC signatures after the resource has validated its
 * crypto capabilities, secret, and required headers.
 *
 * @internal
 */
export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  timestamp: string,
  webhookId: string,
  secret: string,
  tolerance: number,
): Promise<void> {
  // oxlint-disable-next-line unicorn/prefer-number-coercion -- Preserve numeric-prefix parsing while signing the original timestamp text.
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (Number.isNaN(timestampSeconds)) {
    throw new InvalidWebhookSignatureError('Invalid webhook timestamp format');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - timestampSeconds > tolerance) {
    throw new InvalidWebhookSignatureError('Webhook timestamp is too old');
  }
  if (timestampSeconds > nowSeconds + tolerance) {
    throw new InvalidWebhookSignatureError('Webhook timestamp is too new');
  }

  // Multiple signatures are space-separated; accept the first matching value.
  const signatures = signatureHeader
    .split(' ')
    .map((part) => (part.startsWith('v1,') ? part.slice(3) : part));
  const decodedSecret = Uint8Array.from(
    secret.startsWith('whsec_') ? fromBase64(secret.slice('whsec_'.length)) : encodeUTF8(secret),
  );
  const signedPayload = webhookId ? `${webhookId}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
  const signedPayloadBytes = Uint8Array.from(encodeUTF8(signedPayload));
  const key = await crypto.subtle.importKey('raw', decodedSecret, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ]);

  for (const signature of signatures) {
    try {
      const signatureBytes = Uint8Array.from(fromBase64(signature));
      // oxlint-disable-next-line no-await-in-loop -- Check signatures in order and stop at the first match.
      const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, signedPayloadBytes);
      if (isValid) {
        return;
      }
    } catch {
      // Invalid base64 or signature format does not prevent trying the next value.
    }
  }

  throw new InvalidWebhookSignatureError('The given webhook signature does not match the expected signature');
}
