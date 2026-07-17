import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../src/pages/api/node-test';

it('does not expose stack traces from unexpected Node runtime errors', async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const end = jest.fn();
  const status = jest.fn(() => ({ end }));
  delete process.env.OPENAI_API_KEY;

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
    consoleError.mockRestore();
  }
});
