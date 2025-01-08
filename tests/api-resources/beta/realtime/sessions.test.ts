// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'My API Key',
  baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
});

describe('resource sessions', () => {
  test('create: only required params', async () => {
    const responsePromise = client.beta.realtime.sessions.create({ model: 'gpt-4o-realtime-preview' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  test('create: required and optional params', async () => {
    const response = await client.beta.realtime.sessions.create({
      model: 'gpt-4o-realtime-preview',
      input_audio_format: 'pcm16',
      input_audio_transcription: { model: 'model' },
      instructions: 'instructions',
      max_response_output_tokens: 0,
      modalities: ['text'],
      output_audio_format: 'pcm16',
      temperature: 0,
      tool_choice: 'tool_choice',
      tools: [{ description: 'description', name: 'name', parameters: {}, type: 'function' }],
      turn_detection: {
        create_response: true,
        prefix_padding_ms: 0,
        silence_duration_ms: 0,
        threshold: 0,
        type: 'type',
      },
      voice: 'alloy',
    });
  });
});
