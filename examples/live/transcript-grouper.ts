import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import OpenAI from 'openai';
import { prepareTranscriptDemo, runTranscriptDemo } from './transcript-demo';
import { createPCMPlayback } from './transcript-playback';

async function main(): Promise<void> {
  const playback = process.argv.includes('--no-audio')
    ? undefined
    : { user: createPCMPlayback(), assistant: createPCMPlayback() };
  const finish = new AbortController();
  let input: Interface | undefined;
  const stop = () => finish.abort();
  try {
    const client = new OpenAI({ logLevel: 'off' });
    console.log('All voices are AI-generated. Preparing both TTS clips before connecting to Live…');
    const audio = await prepareTranscriptDemo(client);
    console.log(playback ? 'Playing both voices through playAudio (ffplay).' : 'Audio playback disabled.');
    console.log('TTS ready. Starting a picnic conversation, then interrupting with a breakfast request.');
    input = createInterface({ input: process.stdin, output: process.stdout });
    input.once('line', stop);
    input.once('close', stop);
    console.log('Press Enter to finish capturing the transcript and close the session.');
    const result = await runTranscriptDemo(client, audio, {
      finishSignal: finish.signal,
      interrupt: true,
      onInputAudio: (pcm) => playback?.user.write(pcm),
      onOutputAudio: (pcm) => playback?.assistant.write(pcm),
      onClosed: ({ segment, reason }) => console.log(`[${segment.speaker}; ${reason}] ${segment.text}`),
    });
    await Promise.all([playback?.user.finish(), playback?.assistant.finish()]);
    console.log(
      `${result.rawTranscriptEvents} raw transcript fragments → ${result.updateCount} bubble updates → ${result.segments.length} final bubbles.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Live example failed';
    const key = process.env['OPENAI_API_KEY'];
    console.error(key ? message.split(key).join('[REDACTED]') : message);
    process.exitCode = 1;
  } finally {
    input?.removeListener('line', stop);
    input?.removeListener('close', stop);
    input?.close();
    await Promise.all([playback?.user.close(), playback?.assistant.close()]);
  }
}

void main();
