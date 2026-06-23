import OpenAI from 'openai';
import { recordAudio } from 'openai/helpers/audio';

const openai = new OpenAI();

async function main(): Promise<void> {
  console.log('Recording for 5 seconds...');
  const response = await recordAudio({ timeout: 5000, device: 4 });

  console.log('Transcribing...');
  const transcription = await openai.audio.transcriptions.create({
    file: response,
    model: 'whisper-1',
  });

  console.log(transcription.text);
}

main().catch(console.error);
