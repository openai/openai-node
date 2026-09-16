import { vi } from 'vitest';
import { OpenAIError } from 'openai/core/error';
import { ReadableStreamFrom } from 'openai/internal/shims';
import { AssistantStream } from 'openai/lib/AssistantStream';
import { completedRun } from './assistant-stream-test-utils';

describe('AssistantStream primitive wire frames', () => {
  test.each([null, false, true, 0, 7, '', 'primitive'])(
    'rejects the primitive frame %j before exposing an event',
    async (primitive) => {
      const encoder = new TextEncoder();
      const frames = [primitive, completedRun()];
      const readable = ReadableStreamFrom(
        frames.map((frame) => encoder.encode(`${JSON.stringify(frame)}\n`)),
      );
      const runner = AssistantStream.fromReadableStream(readable);
      const events = vi.fn();
      runner.on('event', events);

      await expect(runner.done()).rejects.toBeInstanceOf(OpenAIError);
      await expect(runner.finalRun()).rejects.toBeInstanceOf(OpenAIError);
      expect(events).not.toHaveBeenCalled();
      expect(runner.currentEvent()).toBeUndefined();
    },
  );
});
