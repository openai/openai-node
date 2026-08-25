import { InvalidWebhookSignatureError } from '../error';
import { fromBase64 } from '../internal/utils/base64';
import { encodeUTF8 } from '../internal/utils/bytes';

const MAX_DIRECT_WEBHOOK_VERIFICATIONS = 32;
const SHA256_SIGNATURE_LENGTH = 32;

function decodeUniqueSignatures(signatures: string[]): Uint8Array[] {
  const seenSignatures = new Set<string>();
  const candidateSignatures: Uint8Array[] = [];

  for (const signature of signatures) {
    if (seenSignatures.has(signature)) {
      continue;
    }
    seenSignatures.add(signature);

    try {
      const signatureBytes = Uint8Array.from(fromBase64(signature));
      if (signatureBytes.byteLength === SHA256_SIGNATURE_LENGTH) {
        candidateSignatures.push(signatureBytes);
      }
    } catch {
      // Invalid base64 does not prevent trying the next value.
    }
  }

  return candidateSignatures;
}

function selectMatchingSignature(
  signatures: Uint8Array[],
  expectedSignature: Uint8Array,
): Uint8Array | undefined {
  let [matchingSignature] = signatures;

  for (const signature of signatures) {
    let difference = 0;
    for (const [index, byte] of signature.entries()) {
      // oxlint-disable-next-line no-bitwise -- Compare every HMAC byte without short-circuiting on shared prefixes.
      difference |= byte ^ (expectedSignature[index] ?? 0);
    }
    if (difference === 0) {
      matchingSignature = signature;
    }
  }

  return matchingSignature;
}

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
  const useBoundedVerification = signatures.length > MAX_DIRECT_WEBHOOK_VERIFICATIONS;
  const candidateSignatures = useBoundedVerification ? decodeUniqueSignatures(signatures) : [];

  if (useBoundedVerification && candidateSignatures.length === 0) {
    throw new InvalidWebhookSignatureError(
      'The given webhook signature does not match the expected signature',
    );
  }

  const decodedSecret = Uint8Array.from(
    secret.startsWith('whsec_') ? fromBase64(secret.slice('whsec_'.length)) : encodeUTF8(secret),
  );
  const signedPayload = webhookId ? `${webhookId}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
  const signedPayloadBytes = Uint8Array.from(encodeUTF8(signedPayload));
  const key = await crypto.subtle.importKey(
    'raw',
    decodedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    useBoundedVerification ? ['sign', 'verify'] : ['verify'],
  );

  if (useBoundedVerification) {
    const expectedSignature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedPayloadBytes));
    const signatureToVerify = selectMatchingSignature(candidateSignatures, expectedSignature);

    if (
      signatureToVerify &&
      (await crypto.subtle.verify('HMAC', key, Uint8Array.from(signatureToVerify), signedPayloadBytes))
    ) {
      return;
    }

    throw new InvalidWebhookSignatureError(
      'The given webhook signature does not match the expected signature',
    );
  }

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
