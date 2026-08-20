import { inspect } from 'node:util';

import { vi } from 'vitest';
import { allSettledWithThrow } from 'openai/lib/Util';

describe('allSettledWithThrow', () => {
  test('returns fulfilled values in their original order', async () => {
    await expect(allSettledWithThrow([Promise.resolve('first'), Promise.resolve('second')])).resolves.toEqual(
      ['first', 'second'],
    );
  });

  test('returns an empty array when there are no promises', async () => {
    await expect(allSettledWithThrow([])).resolves.toEqual([]);
  });

  test('preserves every rejection without logging sensitive errors', async () => {
    const firstError = new Error('first failure');
    const secondError = new Error('second failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        allSettledWithThrow([Promise.reject(firstError), Promise.resolve('ok'), Promise.reject(secondError)]),
      ).rejects.toMatchObject({
        name: 'Error',
        message: '2 promise(s) failed',
        rejections: [firstError, secondError],
      });

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('keeps rejected errors out of serialized aggregate failures', async () => {
    const secret = 'sk-synthetic-private-upload-secret';
    const rejected = allSettledWithThrow([Promise.reject(new Error(secret))]);
    const error = await rejected.catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(Error);

    if (!(error instanceof Error)) {
      throw new Error('Expected the promise to reject with an Error');
    }

    expect(Object.getOwnPropertyDescriptor(error, 'rejections')?.enumerable).toBe(false);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(inspect(error)).not.toContain(secret);
    expect(error.message).not.toContain(secret);
  });
});
