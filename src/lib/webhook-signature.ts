import { InvalidWebhookSignatureError } from '../error';
import { fromBase64 } from '../internal/utils/base64';
import { encodeUTF8 } from '../internal/utils/bytes';

const MAX_DIRECT_WEBHOOK_VERIFICATIONS = 32;
const SHA256_SIGNATURE_LENGTH = 32;

/**
 * Checks whether a webhook header requires constant-work HMAC signing without
 * retaining an unbounded number of signature candidates.
 *
 * @internal
 */
export function webhookSignatureRequiresSigning(signatureHeader: string): boolean {
  return (
    signatureHeader.split(' ', MAX_DIRECT_WEBHOOK_VERIFICATIONS + 1).length > MAX_DIRECT_WEBHOOK_VERIFICATIONS
  );
}

function* signatureCandidates(signatureHeader: string): Generator<string> {
  let start = 0;

  while (start <= signatureHeader.length) {
    const separator = signatureHeader.indexOf(' ', start);
    const candidate = signatureHeader.slice(start, separator === -1 ? undefined : separator);
    yield candidate.startsWith('v1,') ? candidate.slice(3) : candidate;

    if (separator === -1) {
      break;
    }
    start = separator + 1;
  }
}

function decodeSignature(signature: string): Uint8Array | undefined {
  try {
    const signatureBytes = fromBase64(signature);
    return signatureBytes.byteLength === SHA256_SIGNATURE_LENGTH ? signatureBytes : undefined;
  } catch {
    // Invalid base64 does not prevent trying the next value.
    return undefined;
  }
}

function firstValidLengthSignature(signatureHeader: string): Uint8Array | undefined {
  for (const signature of signatureCandidates(signatureHeader)) {
    const signatureBytes = decodeSignature(signature);
    if (signatureBytes) {
      return signatureBytes;
    }
  }

  return undefined;
}

function selectMatchingSignature(
  signatureHeader: string,
  expectedSignature: Uint8Array,
  firstSignature: Uint8Array,
): Uint8Array {
  let matchingSignature = firstSignature;

  for (const signature of signatureCandidates(signatureHeader)) {
    const signatureBytes = decodeSignature(signature);
    if (!signatureBytes) {
      continue;
    }

    let difference = 0;
    for (const [index, byte] of signatureBytes.entries()) {
      // oxlint-disable-next-line no-bitwise -- Compare every HMAC byte without short-circuiting on shared prefixes.
      difference |= byte ^ (expectedSignature[index] ?? 0);
    }
    if (difference === 0) {
      matchingSignature = signatureBytes;
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

  // Multiple signatures are space-separated; accept a matching value at any position.
  const useBoundedVerification = webhookSignatureRequiresSigning(signatureHeader);
  const firstSignature = useBoundedVerification ? firstValidLengthSignature(signatureHeader) : undefined;

  if (useBoundedVerification && !firstSignature) {
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

  if (useBoundedVerification && firstSignature) {
    const expectedSignature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedPayloadBytes));
    const signatureToVerify = selectMatchingSignature(signatureHeader, expectedSignature, firstSignature);

    try {
      if (await crypto.subtle.verify('HMAC', key, Uint8Array.from(signatureToVerify), signedPayloadBytes)) {
        return;
      }
    } catch {
      // Provider verification failures have the same typed mismatch as the direct path.
    }

    throw new InvalidWebhookSignatureError(
      'The given webhook signature does not match the expected signature',
    );
  }

  for (const signature of signatureCandidates(signatureHeader)) {
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
