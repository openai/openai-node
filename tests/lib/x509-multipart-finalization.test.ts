import { vi } from 'vitest';
import OpenAI from 'openai';
import { Agent } from 'undici';
import { createX509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';
import { toStreamingFile } from 'openai/uploads';
import type { FinalRequestOptions } from 'openai/internal/request-options';

async function* bytes() {
  yield new TextEncoder().encode('upload bytes');
}

test.each(
  [false, true].flatMap((streaming) =>
    [undefined, null, 'application/json'].flatMap((contentType) =>
      [undefined, 'application/json'].map((defaultContentType) => ({
        streaming,
        contentType,
        defaultContentType,
      })),
    ),
  ),
)(
  'X509 deferred multipart owns encoding headers without changing snapshots: %j',
  async ({ streaming, contentType, defaultContentType }) => {
    const dispatcher = new Agent();
    const transport = createX509Transport({
      runtime: 'node',
      dispatcher,
      certificateIdentity: 'static',
      proxy: 'direct',
    });
    const requestHeaders = Object.freeze({
      'Content-Type': contentType,
      'X-Removed': null,
      'X-Retained': 'request-value',
    });
    const defaultHeaders = Object.freeze({
      'Content-Type': defaultContentType,
      'X-Removed': 'must-not-return',
      'X-Default': 'default-value',
    });
    const dispatched: {
      sentHeaders: Headers;
      encodedHeaders: Headers;
      sentBody: string;
      isFormData: boolean;
    }[] = [];
    let preparations = 0;
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, init) => {
        if (url.origin === 'https://mtls.auth.openai.com') {
          return Response.json({
            access_token: 'synthetic-token',
            token_type: 'Bearer',
            issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            expires_in: 3600,
          });
        }
        const sentHeaders = new Headers(init.headers);
        const encoded = new Response(init.body, { headers: sentHeaders });
        dispatched.push({
          sentHeaders,
          encodedHeaders: encoded.headers,
          sentBody: await encoded.text(),
          isFormData: init.body instanceof FormData,
        });
        if (!streaming && dispatched.length === 1) {
          return Response.json(
            { error: { message: 'Synthetic retry', type: 'server_error' } },
            { status: 503, headers: { 'retry-after-ms': '1' } },
          );
        }
        return Response.json({ id: 'file_test' });
      });
    class PreparedClient extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        await super.prepareOptions(options);
        preparations += 1;
        if (preparations > 1) {
          return;
        }
        options.body = {
          file: streaming
            ? toStreamingFile(bytes(), 'sample.txt', { type: 'text/plain' })
            : new File(['upload bytes'], 'sample.txt', { type: 'text/plain' }),
        };
      }
    }
    try {
      const client = new PreparedClient({
        apiKey: null,
        maxRetries: streaming ? 0 : 1,
        organization: 'synthetic-organization',
        project: 'synthetic-project',
        defaultHeaders,
        workloadIdentity: {
          type: 'x509',
          identityProviderId: 'synthetic-provider',
          serviceAccountId: 'synthetic-account',
        },
        x509Transport: transport,
      });
      await client.containers.files.create(
        'container_test',
        { file_id: 'existing' },
        { headers: requestHeaders },
      );
      expect(defaultHeaders).toEqual({
        'Content-Type': defaultContentType,
        'X-Removed': 'must-not-return',
        'X-Default': 'default-value',
      });
      expect(requestHeaders).toEqual({
        'Content-Type': contentType,
        'X-Removed': null,
        'X-Retained': 'request-value',
      });
      expect(dispatched).toHaveLength(streaming ? 1 : 2);
      expect(preparations).toBe(streaming ? 1 : 2);
      await Promise.all(
        dispatched.map(async ({ sentHeaders, encodedHeaders, sentBody, isFormData }) => {
          if (!streaming) {
            expect(isFormData).toBe(true);
            expect(sentHeaders.has('content-type')).toBe(false);
          }
          expect(sentHeaders.get('authorization')).toBe('Bearer synthetic-token');
          expect(sentHeaders.get('openai-organization')).toBe('synthetic-organization');
          expect(sentHeaders.get('openai-project')).toBe('synthetic-project');
          expect(sentHeaders.get('x-removed')).toBeNull();
          expect(sentHeaders.get('x-retained')).toBe('request-value');
          expect(sentHeaders.get('x-default')).toBe('default-value');
          expect(encodedHeaders.get('content-type')).toMatch(/^multipart\/form-data; boundary=/u);
          const form = await new Response(sentBody, { headers: encodedHeaders }).formData();
          const file = form.get('file');
          if (file === null || typeof file === 'string') {
            throw new Error('Expected uploaded file part');
          }
          expect(file.name).toBe('sample.txt');
          expect(file.type).toBe('text/plain');
          expect(await file.text()).toBe('upload bytes');
        }),
      );
    } finally {
      send.mockRestore();
      await dispatcher.close();
    }
  },
);
