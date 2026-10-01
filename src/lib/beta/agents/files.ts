import type { OpenAI } from '../../../client';
import { OpenAIError } from '../../../core/error';
import { buildHeaders } from '../../../internal/headers';
import type { RequestOptions } from '../../../internal/request-options';
import type { Uploadable } from '../../../internal/uploads';
import type { FileObject } from '../../../resources/files';
import type {
  EnvironmentFile,
  FileCreateParams,
  Files,
} from '../../../resources/beta/agents/environments/files';

/** Beta: file references ready for a hosted environment, plus caller-owned uploads. */
export interface PreparedAgentFiles {
  files: Extract<FileCreateParams, { type: 'file_id' }>[];
  uploadedFiles: FileObject[];
}

/** Beta: uploaded file IDs remain available after partial preparation or staging failure. */
export class AgentFileUploadError extends OpenAIError {
  override readonly name = 'AgentFileUploadError';
  declare readonly cause: unknown;
  readonly uploadedFiles: FileObject[];
  constructor(uploadedFiles: FileObject[], cause: unknown) {
    super('Agent file preparation or staging failed; uploaded files remain caller-owned.');
    this.uploadedFiles = uploadedFiles;
    Object.defineProperty(this, 'cause', { value: cause, configurable: true });
  }
}

const MAX_BYTES = 50 * 1024 * 1024;

/** @internal */
export function validateAgentFilePath(path: string): void {
  const parts = path.split('/');
  const root = parts[2] ?? '';
  if (
    !path.startsWith('/workspace/') ||
    [...path].length > 4096 ||
    path.includes('\\') ||
    path.includes('\0') ||
    parts.slice(1).some((part) => part === '' || part === '.' || part === '..') ||
    root === '.codex' ||
    root === '.managed-agents' ||
    root.startsWith('.managed-agents-') ||
    path === '/workspace/outputs'
  ) {
    throw new OpenAIError('Agent files require a non-reserved absolute file path inside /workspace');
  }
}

function preflight(files: Record<string, Uploadable>, options: RequestOptions): [string, Uploadable][] {
  const entries = Object.entries(files);
  if (entries.length > 50) {
    throw new OpenAIError('A hosted environment accepts at most 50 initial files');
  }
  const headers = buildHeaders([options.headers]);
  if (
    entries.length > 1 &&
    (headers.values.has('idempotency-key') ||
      (!headers.nulls.has('idempotency-key') && options?.idempotencyKey !== undefined))
  ) {
    throw new OpenAIError('Do not reuse an Idempotency-Key across multiple file uploads');
  }
  let bytes = 0;
  const paths: string[] = [];
  for (const [path, file] of entries) {
    validateAgentFilePath(path);
    if (paths.some((other) => path.startsWith(`${other}/`) || other.startsWith(`${path}/`))) {
      throw new OpenAIError('Agent file destinations conflict');
    }
    paths.push(path);
    if ('size' in file) {
      const { size } = file;
      if (!Number.isFinite(size) || size < 0 || size > MAX_BYTES) {
        throw new OpenAIError('Agent file exceeds the 50 MiB limit');
      }
      bytes += size;
    }
  }
  if (bytes > MAX_BYTES) {
    throw new OpenAIError('Initial agent files exceed the 50 MiB aggregate limit');
  }
  return entries;
}

/** @internal */
export async function prepareAgentFiles(
  client: OpenAI,
  files: Record<string, Uploadable>,
  options?: RequestOptions,
): Promise<PreparedAgentFiles> {
  const requestOptions = { ...options };
  // Internal SDK read: capture effective headers once, including defaults and explicit omissions.
  const headers = buildHeaders([client['_options'].defaultHeaders, requestOptions.headers]);
  requestOptions.headers = headers;
  const entries = preflight(files, requestOptions);
  if (entries.length > 1) {
    // Keep a later mutation of client defaults from adding one key to this entire batch.
    headers.nulls.add('idempotency-key');
  }
  const prepared: PreparedAgentFiles = { files: [], uploadedFiles: [] };
  let bytes = 0;
  try {
    for (const [path, file] of entries) {
      // oxlint-disable-next-line no-await-in-loop -- Stop on the first failure and expose precisely the uploads already created.
      const uploaded = await client.files.create({ file, purpose: 'user_data' }, requestOptions);
      prepared.uploadedFiles.push(uploaded);
      // Streams may not have a known size until the Files API finishes the upload.
      if (uploaded.bytes > MAX_BYTES) {
        throw new OpenAIError('Agent file exceeds the 50 MiB limit');
      }
      bytes += uploaded.bytes;
      if (bytes > MAX_BYTES) {
        throw new OpenAIError('Initial agent files exceed the 50 MiB aggregate limit');
      }
      prepared.files.push({ type: 'file_id', file_id: uploaded.id, path });
    }
    return prepared;
  } catch (error) {
    throw new AgentFileUploadError(prepared.uploadedFiles, error);
  }
}

/** @internal */
export async function uploadAgentFile(
  client: OpenAI,
  resource: Files,
  environmentID: string,
  params: { file: Uploadable; path: string },
  options?: RequestOptions,
): Promise<{ uploadedFile: FileObject; environmentFile: EnvironmentFile }> {
  const prepared = await prepareAgentFiles(client, { [params.path]: params.file }, options);
  const [reference] = prepared.files;
  const [uploadedFile] = prepared.uploadedFiles;
  if (!reference || !uploadedFile) {
    throw new OpenAIError('Missing prepared agent file');
  }
  try {
    return { uploadedFile, environmentFile: await resource.create(environmentID, reference, options) };
  } catch (error) {
    throw new AgentFileUploadError(prepared.uploadedFiles, error);
  }
}
