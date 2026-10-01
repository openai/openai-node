import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import nodePath from 'node:path';
import { OpenAIError } from '../../../core/error';
import { toStreamingFile } from '../../../internal/uploads';
import type { StreamingFile } from '../../../internal/uploads';
import type { RequestOptions } from '../../../internal/request-options';
import type { Files } from '../../../resources/beta/agents/environments/files';
import type { PreparedAgentFiles } from '../../../lib/beta/agents/files';

async function checkedPath(path: string, boundary?: string): Promise<string> {
  const absolute = nodePath.resolve(path);
  const root = boundary ?? nodePath.dirname(absolute);
  let current = root;
  for (const component of nodePath.relative(root, absolute).split(nodePath.sep)) {
    current = nodePath.join(current, component);
    // oxlint-disable-next-line no-await-in-loop -- Check each ancestor before following the next path component.
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new OpenAIError('Agent file sources cannot contain symbolic links');
    }
  }
  return realpath(absolute);
}

/** Beta, Node.js: select a regular local file for a lazy Files API upload. */
export async function agentFile(path: string): Promise<StreamingFile & { size: number }> {
  const absolute = await checkedPath(path);
  const info = await lstat(absolute);
  if (!info.isFile()) {
    throw new OpenAIError('Agent file sources must be regular files');
  }
  async function* bytes() {
    // oxlint-disable-next-line no-bitwise -- Combine native filesystem open flags.
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (
        !current.isFile() ||
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        current.size !== info.size
      ) {
        throw new OpenAIError('Selected agent file changed before upload');
      }
      yield* handle.createReadStream({ autoClose: false });
    } finally {
      await handle.close();
    }
  }
  return Object.assign(toStreamingFile({ [Symbol.asyncIterator]: bytes }, nodePath.basename(absolute)), {
    size: info.size,
  });
}

/** Beta, Node.js: prepare explicitly selected relative files from a directory once. */
export async function prepareAgentDirectory(
  resource: Files,
  directory: string,
  params: { include: readonly string[]; to?: string },
  options?: RequestOptions,
): Promise<PreparedAgentFiles> {
  const include = [...params.include];
  const destination = params.to ?? '/workspace';
  if (include.length > 50) {
    throw new OpenAIError('A hosted environment accepts at most 50 initial files');
  }
  const root = await checkedPath(directory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) {
    throw new OpenAIError('Expected a directory');
  }
  const selected: Record<string, StreamingFile & { size: number }> = {};
  const seen = new Set<string>();
  for (const relative of include) {
    if (
      relative.includes('\\') ||
      relative.includes('\0') ||
      relative.split('/').some((part) => part === '' || part === '.' || part === '..') ||
      seen.has(relative)
    ) {
      throw new OpenAIError('Directory selections must be unique relative file paths');
    }
    seen.add(relative);
    // oxlint-disable-next-line no-await-in-loop -- Prepare each explicitly selected source before any upload begins.
    const source = await checkedPath(nodePath.join(root, relative), root);
    // oxlint-disable-next-line no-await-in-loop -- Preserve explicit file selection order before upload.
    selected[`${destination}/${relative}`] = await agentFile(source);
  }
  return resource.prepare(selected, options);
}

/** Beta, Node.js: a chosen local destination, opened only when a download writes or completes. */
export function agentFileDestination(path: string): WritableStream<Uint8Array> {
  const absolute = nodePath.resolve(path);
  let handle: FileHandle | undefined;
  const close = async () => {
    await handle?.close();
    handle = undefined;
  };
  const file = async () => (handle ??= await open(absolute, 'w'));
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      try {
        const target = await file();
        await target.writeFile(chunk);
      } catch (error) {
        await close();
        throw error;
      }
    },
    async close() {
      await file();
      await close();
    },
    async abort() {
      await close();
    },
  });
}
