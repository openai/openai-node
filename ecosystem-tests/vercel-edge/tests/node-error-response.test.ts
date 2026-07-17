import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../src/pages/api/node-test';

it('does not expose stack traces from unexpected Node runtime errors', async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const end = jest.fn();
  const status = jest.fn(() => ({ end }));
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_ADMIN_KEY;

  try {
    await handler({} as NextApiRequest, { status } as unknown as NextApiResponse);

    expect(status).toHaveBeenCalledWith(500);
    expect(end).toHaveBeenCalledWith('Internal Server Error');
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

it('does not expose stack traces from failed Node test handlers', async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sensitive stack trace'));
  const end = jest.fn();
  const status = jest.fn(() => ({ end }));
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    await handler({} as NextApiRequest, { status } as unknown as NextApiResponse);

    expect(status).toHaveBeenCalledWith(500);
    expect(end).toHaveBeenCalledWith('Internal Server Error');
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
