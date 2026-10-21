import { vi } from 'vitest';
import OpenAI from 'openai';
import { Agent } from 'undici';
import { createX509Transport } from 'openai/auth/x509-transport';
import * as transportCapability from 'openai/internal/auth/x509-transport-capability';
import type { FinalRequestOptions } from 'openai/internal/request-options';

test.each(['application/custom', null, undefined])(
  'X509 retry replacement retains caller Content-Type: %j',
  async (contentType) => {
    const dispatcher = new Agent();
    const transport = createX509Transport({
      runtime: 'node',
      dispatcher,
      certificateIdentity: 'static',
      proxy: 'direct',
    });
    const requestHeaders = Object.freeze({ 'Content-Type': contentType, 'X-Retained': 'request-value' });
    const sent: { headers: Headers; body: string }[] = [];
    const dispatch = async (url: URL, init: RequestInit) => {
      if (url.origin === 'https://mtls.auth.openai.com') {
        return Response.json({
          access_token: 'synthetic-token',
          token_type: 'Bearer',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          expires_in: 3600,
        });
      }
      sent.push({ headers: new Headers(init.headers), body: await new Response(init.body).text() });
      return sent.length === 1
        ? Response.json(
            { error: { message: 'Synthetic retry' } },
            {
              status: 503,
              headers: { 'retry-after-ms': '1' },
            },
          )
        : Response.json({ id: 'file_test' });
    };
    const send = vi
      .spyOn(transportCapability, 'sendX509Request')
      .mockImplementation(async (_transport, url, init) => dispatch(url, init));
    let preparations = 0;
    class PreparedClient extends OpenAI {
      protected override async prepareOptions(options: FinalRequestOptions) {
        await super.prepareOptions(options);
        preparations += 1;
        if (preparations === 1) {
          options.body = { file: new File(['upload bytes'], 'sample.txt', { type: 'text/plain' }) };
        } else {
          options.body =
            contentType === 'application/custom'
              ? 'replacement bytes'
              : new TextEncoder().encode('replacement bytes');
        }
      }
    }
    try {
      const client = new PreparedClient({
        apiKey: null,
        maxRetries: 1,
        defaultHeaders: { 'Content-Type': 'application/default' },
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
      expect(preparations).toBe(2);
      expect(sent).toHaveLength(2);
      expect(sent[0]?.headers.has('content-type')).toBe(false);
      expect(sent[1]?.headers.get('content-type')).toBe(
        contentType === undefined ? 'application/default' : contentType,
      );
      expect(sent[1]?.body).toBe('replacement bytes');
      expect(sent[1]?.headers.get('x-retained')).toBe('request-value');
      expect(sent[1]?.headers.get('authorization')).toBe('Bearer synthetic-token');
      expect(requestHeaders).toEqual({ 'Content-Type': contentType, 'X-Retained': 'request-value' });
    } finally {
      send.mockRestore();
      await dispatcher.close();
    }
  },
);
