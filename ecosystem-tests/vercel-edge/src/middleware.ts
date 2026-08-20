import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const minimumTokenLength = 32;
const maximumRequestBodyBytes = 64 * 1024;

function matchesAuthorization(actual: string, expected: string): boolean {
  let difference = Math.abs(actual.length - expected.length);

  for (let index = 0; index < expected.length; index += 1) {
    difference += Number(actual[index] !== expected[index]);
  }

  return difference === 0;
}

export function middleware(request: NextRequest): NextResponse {
  const token = process.env.VERCEL_EDGE_TEST_TOKEN;
  const authorization = request.headers.get('authorization') ?? '';

  if (
    !token ||
    token.length < minimumTokenLength ||
    !matchesAuthorization(authorization, `Bearer ${token}`)
  ) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer' },
    });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > maximumRequestBodyBytes) {
    return new NextResponse('Payload Too Large', { status: 413 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
