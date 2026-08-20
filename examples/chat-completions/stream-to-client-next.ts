import OpenAI from 'openai';

// This file demonstrates how to stream from a Next.JS Edge handler as a
// newline-separated JSON stream. It requires Next.JS scaffolding.
//
// Configure a dedicated, server-only application secret with at least 32 characters:
//
//   OPENAI_EXAMPLE_AUTH_TOKEN=your-dedicated-long-application-secret
//
// Trusted server-side proxies that forward browser Origin headers must configure
// an explicit trusted origin:
//
//   OPENAI_EXAMPLE_ALLOWED_ORIGIN=https://your-application.example
//
// A trusted server-side process or command-line client can call this endpoint:
//
//   curl 127.0.0.1:3000 -N -X POST \
//     -H "Authorization: Bearer $OPENAI_EXAMPLE_AUTH_TOKEN" \
//     -H 'Content-Type: text/plain' \
//     --data 'Can you explain why dogs are better than cats?'
//
// Never expose your OpenAI API key or the dedicated bearer secret to a browser,
// browser JavaScript, or browser developer tools. Browser clients must instead
// use a separate session-authenticated server endpoint; only that trusted
// server-side endpoint may attach the bearer secret. The secret is verified
// before creating an OpenAI client or reading an untrusted request.
//
// See examples/chat-completions/stream-to-client-browser.ts for a more complete example.

export const config = {
  runtime: 'edge',
};

const maximumPromptBytes = 64 * 1024;

function hasValidBearerToken(request: Request, expected: string): boolean {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return false;
  }

  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const actualBytes = encoder.encode(authorization.slice('Bearer '.length));
  const lengthDifference = expectedBytes.length - actualBytes.length;
  let difference = lengthDifference * lengthDifference;

  for (let index = 0; index < expectedBytes.length; index += 1) {
    const byteDifference = (expectedBytes[index] ?? 0) - (actualBytes[index] ?? 0);
    difference += byteDifference * byteDifference;
  }

  return difference === 0;
}

function validateRequest(request: Request): Response | null {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    return new Response('Cross-origin requests are not allowed', { status: 403 });
  }

  const origin = request.headers.get('origin');
  if (origin !== null && origin !== process.env['OPENAI_EXAMPLE_ALLOWED_ORIGIN']) {
    return new Response('Cross-origin requests are not allowed', { status: 403 });
  }

  const expectedToken = process.env['OPENAI_EXAMPLE_AUTH_TOKEN'];
  if (!expectedToken || expectedToken.length < 32) {
    return new Response('Example authorization is not configured', { status: 503 });
  }

  if (!hasValidBearerToken(request, expectedToken)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!/^\d+$/u.test(contentLength) || !Number.isSafeInteger(length)) {
      return new Response('Invalid Content-Length', { status: 400 });
    }
    if (length > maximumPromptBytes) {
      return new Response('Request body exceeds 64 KiB', { status: 413 });
    }
  }

  return null;
}

async function readBoundedPrompt(request: Request): Promise<string | Response> {
  if (!request.body) {
    return '';
  }

  const decoder = new TextDecoder();
  let byteLength = 0;
  let prompt = '';

  for await (const chunk of request.body) {
    byteLength += chunk.byteLength;
    if (byteLength > maximumPromptBytes) {
      return new Response('Request body exceeds 64 KiB', { status: 413 });
    }

    prompt += decoder.decode(chunk, { stream: true });
  }

  return prompt + decoder.decode();
}

export default async function handler(request: Request): Promise<Response> {
  const rejection = validateRequest(request);
  if (rejection) {
    return rejection;
  }

  const prompt = await readBoundedPrompt(request);
  if (prompt instanceof Response) {
    return prompt;
  }

  const openai = new OpenAI();
  const stream = openai.chat.completions.stream({
    model: 'gpt-3.5-turbo',
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Response(stream.toReadableStream());
}
