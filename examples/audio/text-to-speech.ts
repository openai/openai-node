import OpenAI from 'openai';
import { playAudio } from 'openai/helpers/audio';

const openai = new OpenAI();

const exampleText = `
I see skies of blue and clouds of white
The bright blessed days, the dark sacred nights
And I think to myself
What a wonderful world
`.trim();

async function main(): Promise<void> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: exampleText,
  });

  await playAudio(response);
}

main().catch(console.error);
