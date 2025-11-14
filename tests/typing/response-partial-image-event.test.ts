import type { ResponseImageGenCallPartialImageEvent } from 'openai/resources/responses/responses';

// This test is intentionally simple: it verifies the SDK exposes the right
// fields on the streaming partial image event by constructing a value that
// matches the observed payload shape. If this ever stops compiling, the
// typings regressed.

describe('ResponseImageGenCallPartialImageEvent typing', () => {
  test('accepts full payload with image options', () => {
    const evt: ResponseImageGenCallPartialImageEvent = {
      type: 'response.image_generation_call.partial_image',
      sequence_number: 7,
      output_index: 0,
      item_id: 'ig_123',
      partial_image_index: 2,
      partial_image_b64: '...base64...',
      size: '1024x1536',
      quality: 'high',
      background: 'opaque',
      output_format: 'png',
    };

    expect(evt).toHaveProperty('type', 'response.image_generation_call.partial_image');
    expect(evt).toHaveProperty('size', '1024x1536');
    expect(evt).toHaveProperty('quality', 'high');
    expect(evt).toHaveProperty('background', 'opaque');
    expect(evt).toHaveProperty('output_format', 'png');
  });

  test('optional fields can be omitted', () => {
    const evt: ResponseImageGenCallPartialImageEvent = {
      type: 'response.image_generation_call.partial_image',
      sequence_number: 1,
      output_index: 0,
      item_id: 'ig_omit',
      partial_image_index: 0,
      partial_image_b64: 'AAA',
      // size, quality, background, output_format are optional
    };

    expect(evt.item_id).toBe('ig_omit');
  });
});
