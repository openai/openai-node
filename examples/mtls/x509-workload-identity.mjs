#!/usr/bin/env node

// Uses one caller-owned static client certificate for both OpenAI's issuer and API.
import { readFile } from 'node:fs/promises';
import { Agent, ProxyAgent } from 'undici';

const cert = await requiredPem('OPENAI_X509_CLIENT_CERTIFICATE_CHAIN_PEM', 'OPENAI_MTLS_CERT_CHAIN');
const key = await requiredPem('OPENAI_X509_CLIENT_PRIVATE_KEY_PEM', 'OPENAI_MTLS_KEY');
const passphrase = process.env['OPENAI_X509_CLIENT_KEY_PASSPHRASE'];
const requestTls = { cert, key, ...(passphrase === undefined ? {} : { passphrase }) };
const proxyMode = process.env['OPENAI_X509_PROXY_MODE'] ?? 'direct';
const proxy = new Map([
  ['direct', 'direct'],
  ['http_connect', 'http-connect'],
  ['https_connect', 'https-connect'],
]).get(proxyMode);
if (!proxy) {
  throw new Error('OPENAI_X509_PROXY_MODE must be direct, http_connect, or https_connect.');
}
const proxyURL = proxy === 'direct' ? undefined : approvedProxyURL(requiredEnv('HTTPS_PROXY', 'https_proxy'));
if (proxyURL && proxyURL.protocol !== (proxy === 'https-connect' ? 'https:' : 'http:')) {
  throw new Error('OPENAI_X509_PROXY_MODE must match the HTTPS_PROXY protocol.');
}
const identityProviderId = requiredEnv('OPENAI_X509_IDENTITY_PROVIDER_ID', 'OPENAI_IDENTITY_PROVIDER_ID');
const serviceAccountId = requiredEnv('OPENAI_X509_SERVICE_ACCOUNT_ID', 'OPENAI_SERVICE_ACCOUNT_ID');
const [{ default: OpenAI }, { createX509Transport }] = await Promise.all([
  import('openai'),
  import('openai/auth/x509-transport'),
]);
const dispatcher = createDispatcher(proxyURL, requestTls);
try {
  const x509Transport = createX509Transport({
    runtime: 'node',
    dispatcher,
    certificateIdentity: 'static',
    proxy,
  });
  const client = new OpenAI({
    apiKey: null,
    workloadIdentity: {
      type: 'x509',
      identityProviderId,
      serviceAccountId,
    },
    project: process.env['OPENAI_X509_PROJECT_ID'] ?? null,
    x509Transport,
  });

  const models = await client.models.list();
  console.log(`X.509 workload identity succeeded; received ${models.data.length} models.`);
} finally {
  await dispatcher.close();
}

function requiredEnv(name, alternative) {
  const value = process.env[name] ?? (alternative ? process.env[alternative] : undefined);
  if (!value) {
    throw new Error(
      `Missing required X.509 environment variable: ${name}${alternative ? ` or ${alternative}` : ''}`,
    );
  }
  return value;
}

async function requiredPem(valueName, pathName) {
  const value = process.env[valueName];
  if (value) {
    return value;
  }
  const certificatePath = process.env[pathName];
  if (!certificatePath) {
    throw new Error(`Missing required X.509 environment variable: ${valueName} or ${pathName}`);
  }
  return await readFile(certificatePath, 'utf-8');
}

function approvedProxyURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('HTTPS_PROXY must contain a valid CONNECT proxy URL.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('HTTPS_PROXY must not contain a path, query, or fragment.');
  }
  return url;
}

function createDispatcher(approvedURL, targetTls) {
  if (!approvedURL) {
    return new Agent({ connect: targetTls });
  }
  try {
    return new ProxyAgent({ uri: approvedURL.href, requestTls: targetTls });
  } catch {
    throw new Error('Unable to initialize the approved X.509 CONNECT proxy.');
  }
}
