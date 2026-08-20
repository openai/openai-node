/** Rejects invalid HTTP-field bytes without exposing a private Azure credential. */
export function assertAzureCredentialHeaderValue(value: string): void {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 && code !== 0x09) || code === 0x7f || code > 0xff) {
      throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
    }
  }
}

/** Identifies the two credential-bearing Azure HTTP header fields. */
export function isAzureAuthenticationHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === 'authorization' || normalized === 'api-key';
}

/**
 * Collapses case-insensitive WebSocket credential overrides before validating
 * only the effective values. Callers supply SDK-created plain header records.
 */
export function safeAzureWebSocketHeaders<Headers extends Record<string, unknown>>(
  headers: Headers,
): Headers {
  const safeHeaders = new Map<string, unknown>();
  const authenticationNames = new Map<string, string>();

  for (const [name, value] of Object.entries(headers)) {
    if (!isAzureAuthenticationHeader(name)) {
      safeHeaders.set(name, value);
      continue;
    }

    const normalized = name.toLowerCase();
    const previousName = authenticationNames.get(normalized);
    if (previousName !== undefined) {
      safeHeaders.delete(previousName);
      authenticationNames.delete(normalized);
    }
    if (value === null || value === undefined) {
      continue;
    }
    safeHeaders.set(name, value);
    authenticationNames.set(normalized, name);
  }

  for (const name of authenticationNames.values()) {
    const value = safeHeaders.get(name);
    if (Array.isArray(value)) {
      const { length } = value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 1024) {
        throw new TypeError('Azure OpenAI credential contains an invalid HTTP header value.');
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const entry = value[index];
        if (typeof entry === 'string') {
          assertAzureCredentialHeaderValue(entry);
        }
        snapshot.push(entry);
      }
      safeHeaders.set(name, snapshot);
    } else if (typeof value === 'string') {
      assertAzureCredentialHeaderValue(value);
    }
  }
  return Object.fromEntries(safeHeaders) as Headers;
}
