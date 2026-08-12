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

  test('logs every rejection and reports how many promises failed', async () => {
    const firstError = new Error('first failure');
    const secondError = new Error('second failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        allSettledWithThrow([Promise.reject(firstError), Promise.resolve('ok'), Promise.reject(secondError)]),
      ).rejects.toThrow('2 promise(s) failed - see the above errors');

      expect(consoleError).toHaveBeenNthCalledWith(1, firstError);
      expect(consoleError).toHaveBeenNthCalledWith(2, secondError);
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
