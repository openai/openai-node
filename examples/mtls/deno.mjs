#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net

// Demonstrates API-key + HTTP mTLS with OpenAI in Deno. Certificate handling
// stays in Deno's HTTP client so the SDK can use its existing transport hooks.

import OpenAI from 'npm:openai';

const cert = await Deno.readTextFile(requiredEnv('OPENAI_MTLS_CERT_PATH'));
const key = await Deno.readTextFile(requiredEnv('OPENAI_MTLS_KEY_PATH'));
const httpClient = Deno.createHttpClient(clientCertificateOptions(cert, key));

const client = new OpenAI({
  apiKey: requiredEnv('OPENAI_API_KEY'),
  baseURL: Deno.env.get('OPENAI_BASE_URL') ?? 'https://mtls.api.openai.com/v1',
  fetch: (input, init) => fetch(input, { ...init, client: httpClient }),
  fetchOptions: {
    redirect: 'manual',
  },
});

try {
  const models = await client.models.list();
  console.log('mTLS request succeeded; received ' + models.data.length + ' models.');
} finally {
  httpClient.close();
}

function requiredEnv(name) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value;
}

// Deno renamed these options in 1.41.3. Keep the example compatible with the
// SDK's supported Deno 1.28+ range as well as current Deno releases.
function clientCertificateOptions(cert, key) {
  const [major, minor, patch] = Deno.version.deno.split('.').map(Number);
  const supportsCertAndKey = major > 1 || (major === 1 && (minor > 41 || (minor === 41 && patch >= 3)));

  return supportsCertAndKey ? { cert, key } : { certChain: cert, privateKey: key };
}
