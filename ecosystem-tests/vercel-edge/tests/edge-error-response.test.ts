import type { NextRequest } from 'next/server';
import handler from '../src/pages/api/edge-test';

it('does not expose stack traces from unexpected edge runtime errors', async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_ADMIN_KEY;

  try {
    const response = await handler({} as NextRequest);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  } finally {
    if (apiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = apiKey;
    }
    if (adminKey === undefined) {
      delete process.env.OPENAI_ADMIN_KEY;
    } else {
      process.env.OPENAI_ADMIN_KEY = adminKey;
    }
    consoleError.mockRestore();
  }
});

it('does not expose stack traces from failed edge test handlers', async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sensitive stack trace'));
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const response = await handler({} as NextRequest);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  } finally {
    if (apiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = apiKey;
    }
    fetch.mockRestore();
    consoleError.mockRestore();
  }
});
