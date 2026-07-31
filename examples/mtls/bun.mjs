#!/usr/bin/env bun

// Demonstrates API-key + HTTP mTLS with OpenAI in Bun. Certificate handling
// stays in Bun's native fetch so the SDK can use its existing transport hooks.

import OpenAI from 'openai';

const cert = Bun.file(requiredEnv('OPENAI_MTLS_CERT_PATH'));
const key = Bun.file(requiredEnv('OPENAI_MTLS_KEY_PATH'));

const client = new OpenAI({
  apiKey: requiredEnv('OPENAI_API_KEY'),
  baseURL: process.env['OPENAI_BASE_URL'] ?? 'https://mtls.api.openai.com/v1',
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      tls: { cert, key },
    }),
  fetchOptions: {
    redirect: 'manual',
  },
});

const models = await client.models.list();
console.log('mTLS request succeeded; received ' + models.data.length + ' models.');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}
