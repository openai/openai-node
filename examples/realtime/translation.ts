import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import { OpenAIRealtimeTranslationWS } from 'openai/realtime/translations/ws';

async function main() {
  try {
    const model = process.env['OPENAI_TRANSLATION_MODEL'];
    const [audioPath] = process.argv.slice(2);
    if (!model || !audioPath) {
      throw new Error('Set OPENAI_TRANSLATION_MODEL and pass an input audio file path.');
    }
    const client = new OpenAI();
    const connection = await OpenAIRealtimeTranslationWS.create(client, { model });
    connection.on('error', (error) => console.error(error.message));
    connection.on('session.output_transcript.delta', (event) => process.stdout.write(event.delta));
    try {
      await once(connection.socket.platformSocket, 'open');
      connection.send({ type: 'session.update', session: { audio: { output: { language: 'fr' } } } });
      // Supply audio encoded in the session's supported input format.
      for await (const chunk of createReadStream(audioPath, { highWaterMark: 16 * 1024 })) {
        connection.send({ type: 'session.input_audio_buffer.append', audio: chunk.toString('base64') });
      }
      await connection.finish({ timeoutMs: 30_000 });
      process.stdout.write('\n');
    } finally {
      connection.close();
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

main();
