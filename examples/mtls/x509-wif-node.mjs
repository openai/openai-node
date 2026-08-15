#!/usr/bin/env node

// Toggles between ordinary API-key auth and X.509 workload identity federation.
// Certificate and key ownership stays with the application-created Undici Agent.

import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';

const authMode = process.env['OPENAI_AUTH_MODE'] ?? 'api_key';
if (authMode !== 'api_key' && authMode !== 'x509') {
  throw new Error('OPENAI_AUTH_MODE must be either api_key or x509');
}

const dispatcher =
  authMode === 'x509'
    ? new Agent({
        connect: {
          cert: await readFile(requiredEnv('OPENAI_MTLS_CERTIFICATE_CHAIN')),
          key: await readFile(requiredEnv('OPENAI_MTLS_PRIVATE_KEY')),
          ...(process.env['OPENAI_MTLS_PRIVATE_KEY_PASSWORD']
            ? { passphrase: process.env['OPENAI_MTLS_PRIVATE_KEY_PASSWORD'] }
            : {}),
        },
      })
    : undefined;
const client =
  authMode === 'x509'
    ? new OpenAI({
        apiKey: null,
        workloadIdentity: {
          type: 'x509',
          identityProviderId: requiredEnv('OPENAI_IDENTITY_PROVIDER_ID'),
          serviceAccountId: requiredEnv('OPENAI_SERVICE_ACCOUNT_ID'),
        },
        baseURL: process.env['OPENAI_BASE_URL'],
        fetch: undiciFetch,
        fetchOptions: {
          dispatcher,
          redirect: 'manual',
        },
      })
    : new OpenAI({ apiKey: requiredEnv('OPENAI_API_KEY') });

try {
  const response = await client.responses.create({ model: 'gpt-5.6', input: 'Hello' });
  console.log(response.output_text);
} finally {
  await dispatcher?.close();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
