import { NextRequest } from 'next/server';
import { config, middleware } from '../src/middleware';

const token = 'test-token-with-at-least-thirty-two-characters';
const originalToken = process.env.VERCEL_EDGE_TEST_TOKEN;
const protectedRoutes = [
  '/api/query-params',
  '/api/vercel-ai-streaming',
  '/api/response',
  '/api/streaming',
  '/api/transcribe',
  '/api/edge-test',
  '/api/node-test',
];

beforeEach(() => {
  process.env.VERCEL_EDGE_TEST_TOKEN = token;
});

afterAll(() => {
  if (originalToken === undefined) {
    delete process.env.VERCEL_EDGE_TEST_TOKEN;
  } else {
    process.env.VERCEL_EDGE_TEST_TOKEN = originalToken;
  }
});

it('applies the authentication boundary to every API route', () => {
  expect(config.matcher).toBe('/api/:path*');
});

it.each(protectedRoutes)('rejects an unauthenticated request to %s', (path) => {
  const response = middleware(new NextRequest(`https://example.com${path}`));

  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toBe('Bearer');
});

it.each(['', 'Bearer wrong-token', `Basic ${token}`, token, `Bearer ${token} extra`])(
  'rejects the invalid authorization header %p',
  (authorization) => {
    const request = new NextRequest('https://example.com/api/query-params', {
      headers: { authorization },
    });

    expect(middleware(request).status).toBe(401);
  },
);

it('fails closed when its separate access token is not configured', () => {
  delete process.env.VERCEL_EDGE_TEST_TOKEN;
  const request = new NextRequest('https://example.com/api/query-params', {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(middleware(request).status).toBe(401);
});

it('rejects an insecure access token configuration', () => {
  process.env.VERCEL_EDGE_TEST_TOKEN = 'too-short';
  const request = new NextRequest('https://example.com/api/query-params', {
    headers: { authorization: 'Bearer too-short' },
  });

  expect(middleware(request).status).toBe(401);
});

it('does not treat proxy or middleware headers as authorization', () => {
  const request = new NextRequest('https://example.com/api/query-params', {
    headers: {
      'x-forwarded-host': 'localhost',
      'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware',
    },
  });

  expect(middleware(request).status).toBe(401);
});

it('forwards requests carrying the configured bearer token', () => {
  const request = new NextRequest('https://example.com/api/query-params', {
    headers: { authorization: `Bearer ${token}` },
  });
  const response = middleware(request);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-middleware-next')).toBe('1');
});

it('rejects an authenticated request with an oversized declared body', () => {
  const request = new NextRequest('https://example.com/api/vercel-ai-streaming', {
    headers: { authorization: `Bearer ${token}`, 'content-length': '65537' },
  });

  expect(middleware(request).status).toBe(413);
});

it('checks authorization before inspecting an oversized body', () => {
  const request = new NextRequest('https://example.com/api/vercel-ai-streaming', {
    headers: { 'content-length': '65537' },
  });

  expect(middleware(request).status).toBe(401);
});
