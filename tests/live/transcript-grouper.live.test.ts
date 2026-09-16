import { beforeAll, describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { prepareTranscriptDemo, runTranscriptDemo } from '../../examples/live/transcript-demo';

// Opt in explicitly: these tests use paid TTS and Live calls, never the mock API.
const describeLive = process.env['OPENAI_LIVE_TRANSCRIPT_TEST'] === '1' ? describe : describe.skip;
describeLive('Transcript grouper with TTS input over the public Live API', () => {
  let client: OpenAI;
  let audio: Buffer[];

  beforeAll(async () => {
    if (!process.env['OPENAI_API_KEY']) {
      throw new Error('OPENAI_API_KEY is required');
    }
    client = new OpenAI({ logLevel: 'off' });
    // Generate ALL TTS before EITHER Live session; neither call contains TTS latency.
    audio = await prepareTranscriptDemo(client);
  }, 90_000);

  it.each([false, true])(
    'groups a real conversation (interrupt: %s)',
    async (interrupt) => {
      const result = await runTranscriptDemo(client, audio, {
        interrupt,
        websocketOptions: process.env['OPENAI_LIVE_COMPATIBILITY_HEADER']
          ? { headers: { 'OpenAI-Alpha': process.env['OPENAI_LIVE_COMPATIBILITY_HEADER'] } }
          : undefined,
      });
      const user = result.segments.filter(({ segment }) => segment.speaker === 'user');
      const assistant = result.segments.filter(({ segment }) => segment.speaker === 'assistant');
      expect(user.length).toBeGreaterThanOrEqual(2);
      expect(assistant.length).toBeGreaterThanOrEqual(2);
      expect(result.rawTranscriptEvents).toBeGreaterThan(result.segments.length);
      const groupedUser = user.map(({ segment }) => segment.text).join('');
      expect(groupedUser.split(/\s/u).join('')).toBe(result.rawUserText.split(/\s/u).join(''));
      expect(groupedUser.toLowerCase()).toContain('breakfast');
      expect(result.interruptionSentDuringOutput).toBe(interrupt);
      for (let index = 0; index < result.segments.length; index += 1) {
        expect(result.segments[index]?.segment.previousId).toBe(
          result.segments[index - 1]?.segment.id ?? null,
        );
      }
      console.log(
        JSON.stringify({
          interrupt,
          rawFragments: result.rawTranscriptEvents,
          updates: result.updateCount,
          bubbles: result.segments.map(({ segment, reason }) => ({
            speaker: segment.speaker,
            text: segment.text,
            reason,
          })),
        }),
      );
    },
    150_000,
  );
});
