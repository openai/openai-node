import type { OpenAI } from '../client';
import type { APIPromise } from '../core/api-promise';
import type { RequestOptions } from '../internal/request-options';
import { loggerFor, toFloat32Array } from '../internal/utils';
import type { CreateEmbeddingResponse, Embedding, EmbeddingCreateParams } from '../resources/embeddings';

type Base64EmbeddingResponse = Omit<CreateEmbeddingResponse, 'data'> & {
  data: (Omit<Embedding, 'embedding'> & { embedding: string })[];
};

/**
 * Sends the optimized embeddings request while preserving explicit encodings and
 * the original APIPromise response accessors.
 *
 * @internal
 */
export function createEmbedding(
  client: OpenAI,
  body: EmbeddingCreateParams,
  options?: RequestOptions,
): APIPromise<CreateEmbeddingResponse | Base64EmbeddingResponse> {
  const hasUserProvidedEncodingFormat = !!body.encoding_format;
  // No encoding_format specified, defaulting to base64 for performance reasons.
  // See https://github.com/openai/openai-node/pull/1312.
  const encodingFormat = hasUserProvidedEncodingFormat ? body.encoding_format : 'base64';

  if (hasUserProvidedEncodingFormat) {
    loggerFor(client).debug('embeddings/user defined encoding_format:', body.encoding_format);
  }

  const response: APIPromise<CreateEmbeddingResponse> = client.post('/embeddings', {
    body: {
      ...body,
      encoding_format: encodingFormat,
    },
    ...options,
    __security: { bearerAuth: true },
  });

  // Explicit encodings return the original response promise unchanged.
  if (hasUserProvidedEncodingFormat) {
    return response;
  }

  // The default request uses base64 on the wire, but returns the API's default
  // numeric embedding representation to the caller.
  loggerFor(client).debug('embeddings/decoding base64 embeddings from base64');

  return response._thenUnwrap((data) => {
    if (data && data.data) {
      const embeddings = data.data;
      const { length } = embeddings;
      // Preserve the original iteration length and skip sparse-array holes.
      for (let index = 0; index < length; index += 1) {
        if (index in embeddings) {
          const embeddingBase64Obj = embeddings[index] as Embedding;
          const embeddingBase64Str = embeddingBase64Obj.embedding as unknown as string;
          embeddingBase64Obj.embedding = toFloat32Array(embeddingBase64Str);
        }
      }
    }

    return data;
  });
}
