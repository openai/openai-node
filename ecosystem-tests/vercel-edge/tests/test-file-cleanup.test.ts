import type OpenAI from 'openai';
import { uploadWebApiTestCases } from '../src/uploadWebApiTestCases';

const uploadCases = [
  ['node', 'toFile handles string'],
  ['node', 'toFile handles Blob'],
  ['node', 'toFile handles Uint8Array'],
  ['node', 'toFile handles ArrayBuffer'],
  ['node', 'toFile handles DataView'],
  ['edge', 'toFile handles string'],
  ['edge', 'toFile handles Blob'],
  ['edge', 'toFile handles Uint8Array'],
  ['edge', 'toFile handles ArrayBuffer'],
] as const;

function registerUploadTests(
  runtime: 'node' | 'edge',
  {
    create = jest.fn().mockResolvedValue({ filename: 'finetune.jsonl', id: 'file-test' }),
    deleteFile = jest.fn().mockResolvedValue({ deleted: true }),
    expectEqual = jest.fn(),
  }: { create?: jest.Mock; deleteFile?: jest.Mock; expectEqual?: jest.Mock } = {},
) {
  const tests = new Map<string, () => Promise<void>>();

  uploadWebApiTestCases({
    client: { files: { create, delete: deleteFile } } as unknown as OpenAI,
    it: (description, handler) => tests.set(description, handler),
    expectEqual,
    expectSimilar: jest.fn(),
    runtime,
  });

  return { create, deleteFile, expectEqual, tests };
}

describe('uploaded test file cleanup', () => {
  it.each(uploadCases)('deletes the uploaded file after a successful %s %s test', async (runtime, description) => {
    const { create, deleteFile, expectEqual, tests } = registerUploadTests(runtime);

    await expect(tests.get(description)?.()).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    expect(expectEqual).toHaveBeenCalledWith('finetune.jsonl', 'finetune.jsonl');
    expect(deleteFile).toHaveBeenCalledWith('file-test');
  });

  it.each(uploadCases)('deletes the uploaded file after a failed %s %s assertion', async (runtime, description) => {
    const assertionError = new Error('filename assertion failed');
    const expectEqual = jest.fn(() => {
      throw assertionError;
    });
    const { deleteFile, tests } = registerUploadTests(runtime, { expectEqual });

    await expect(tests.get(description)?.()).rejects.toBe(assertionError);

    expect(deleteFile).toHaveBeenCalledWith('file-test');
  });

  it.each(uploadCases)('does not delete a file after a failed %s %s upload', async (runtime, description) => {
    const uploadError = new Error('upload failed');
    const create = jest.fn().mockRejectedValue(uploadError);
    const { deleteFile, expectEqual, tests } = registerUploadTests(runtime, { create });

    await expect(tests.get(description)?.()).rejects.toBe(uploadError);

    expect(expectEqual).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it.each(['node', 'edge'] as const)('surfaces failed %s file cleanup', async (runtime) => {
    const cleanupError = new Error('cleanup failed');
    const deleteFile = jest.fn().mockRejectedValue(cleanupError);
    const { tests } = registerUploadTests(runtime, { deleteFile });

    await expect(tests.get('toFile handles string')?.()).rejects.toBe(cleanupError);

    expect(deleteFile).toHaveBeenCalledWith('file-test');
  });
});
