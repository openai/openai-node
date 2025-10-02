// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource calls', () => {
  test('accept: only required params', async () => {
    const responsePromise = client.realtime.calls.accept('call_id', { type: 'realtime' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('accept: required and optional params', async () => {
    const response = await client.realtime.calls.accept('call_id', {
      type: 'realtime',
      audio: {
        input: {
          format: { rate: 24000, type: 'audio/pcm' },
          noise_reduction: { type: 'near_field' },
          transcription: { language: 'language', model: 'whisper-1', prompt: 'prompt' },
          turn_detection: {
            type: 'server_vad',
            create_response: true,
            idle_timeout_ms: 5000,
            interrupt_response: true,
            prefix_padding_ms: 0,
            silence_duration_ms: 0,
            threshold: 0,
          },
        },
        output: { format: { rate: 24000, type: 'audio/pcm' }, speed: 0.25, voice: 'ash' },
      },
      include: ['item.input_audio_transcription.logprobs'],
      instructions: 'instructions',
      max_output_tokens: 0,
      model: 'string',
      output_modalities: ['text'],
      prompt: { id: 'id', variables: { foo: 'string' }, version: 'version' },
      tool_choice: 'none',
      tools: [{ description: 'description', name: 'name', parameters: {}, type: 'function' }],
      tracing: 'auto',
      truncation: 'auto',
    });
  });

  test('hangup', async () => {
    const responsePromise = client.realtime.calls.hangup('call_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('refer: only required params', async () => {
    const responsePromise = client.realtime.calls.refer('call_id', { target_uri: 'tel:+14155550123' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('refer: required and optional params', async () => {
    const response = await client.realtime.calls.refer('call_id', { target_uri: 'tel:+14155550123' });
  });

  test('reject', async () => {
    const responsePromise = client.realtime.calls.reject('call_id');
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('reject: request options and params are passed correctly', async () => {
    // ensure the request options are being passed correctly by passing an invalid HTTP method in order to cause an error
    await expect(
      client.realtime.calls.reject('call_id', { status_code: 486 }, { path: '/_stainless_unknown_path' }),
    ).rejects.toThrow(OpenAI.NotFoundError);
  });
});
