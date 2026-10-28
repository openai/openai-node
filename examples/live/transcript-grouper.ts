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
  const cancel = new AbortController();
  let input: Interface | undefined;
  const stop = () => finish.abort();
  const interrupt = () => {
    cancel.abort();
    void playback?.user.close();
    void playback?.assistant.close();
  };
  try {
    const client = new OpenAI({ logLevel: 'off' });
    console.log('All voices are AI-generated. Preparing both TTS clips before connecting to Live…');
    const audio = await prepareTranscriptDemo(client);
    console.log(playback ? 'Playing both voices through ffplay.' : 'Audio playback disabled.');
    console.log('TTS ready. Starting a picnic conversation, then interrupting with a breakfast request.');
    process.once('SIGINT', interrupt);
    if (process.stdin.isTTY) {
      input = createInterface({ input: process.stdin, output: process.stdout });
      input.once('line', stop);
      input.once('close', stop);
      input.once('SIGINT', interrupt);
      console.log('Press Enter to finish capturing the transcript and close the session.');
    } else {
      console.log('Capturing for up to 45 seconds, then closing the session.');
    }
    const result = await runTranscriptDemo(client, audio, {
      finishSignal: input ? finish.signal : AbortSignal.timeout(45_000),
      signal: cancel.signal,
      interrupt: true,
      onInputAudio: (pcm) => playback?.user.write(pcm),
      onOutputAudio: (pcm) => playback?.assistant.write(pcm),
      onClosed: ({ segment, reason }) => console.log(`[${segment.speaker}; ${reason}] ${segment.text}`),
    });
    await Promise.all([playback?.user.finish(), playback?.assistant.finish()]);
    cancel.signal.throwIfAborted();
    console.log(
      `${result.rawTranscriptEvents} raw transcript fragments → ${result.updateCount} bubble updates → ${result.segments.length} final bubbles.`,
    );
  } catch (error) {
    if (cancel.signal.aborted) {
      process.exitCode = 130;
    } else {
      const message = error instanceof Error ? error.message : 'The Live example failed';
      const key = process.env['OPENAI_API_KEY'];
      console.error(key ? message.split(key).join('[REDACTED]') : message);
      process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    input?.removeListener('line', stop);
    input?.removeListener('close', stop);
    input?.removeListener('SIGINT', interrupt);
    input?.close();
    await Promise.all([playback?.user.close(), playback?.assistant.close()]);
  }
}

void main();
