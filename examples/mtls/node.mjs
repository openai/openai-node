#!/usr/bin/env node

// Demonstrates API-key + HTTP mTLS with OpenAI in Node.js. Certificate
// handling stays in Undici so the SDK can use its existing transport hooks.

import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';

const cert = await readFile(requiredEnv('OPENAI_MTLS_CERT_PATH'));
const key = await readFile(requiredEnv('OPENAI_MTLS_KEY_PATH'));
const passphrase = process.env['OPENAI_MTLS_KEY_PASSPHRASE'];

const dispatcher = new Agent({
  connect: {
    cert,
    key,
    ...(passphrase ? { passphrase } : {}),
  },
});

const client = new OpenAI({
  apiKey: requiredEnv('OPENAI_API_KEY'),
  baseURL: process.env['OPENAI_BASE_URL'] ?? 'https://mtls.api.openai.com/v1',
  fetch: undiciFetch,
  fetchOptions: {
    dispatcher,
    redirect: 'manual',
  },
});

try {
  const models = await client.models.list();
  console.log('mTLS request succeeded; received ' + models.data.length + ' models.');
} finally {
  await dispatcher.close();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value;
}
