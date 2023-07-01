import OpenAI from 'openai';
import { TranscriptionCreateParams } from 'openai/resources/audio';

// smoke test that importing and constructing the client works
const openai = new OpenAI({ apiKey: '<invalid API key>' });
console.log(openai);

// smoke test that making an API request works, even if it errors
openai.completions
  .create({
    prompt: 'Say this is a test',
    model: 'text-davinci-003',
  })
  .catch((err) => console.error(err));

async function typeTests() {
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: { foo: true }, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: null, model: 'whisper-1' });
  // @ts-expect-error this should error if the `Uploadable` type was resolved correctly
  await openai.audio.transcriptions.create({ file: 'test', model: 'whisper-1' });

  const url = 'https://audio-samples.github.io/samples/mp3/blizzard_biased/sample-1.mp3';
  const model = 'whisper-1';

  const file = await fetch(url);
  const params: TranscriptionCreateParams = { file, model };

  await openai.audio.transcriptions.create(params);
}

// --------
class Greeter {
  greeting: string;
  constructor(message: string) {
    this.greeting = message;
  }
  greet(): string {
    return `Hello, ${this.greeting}`;
  }
}

const greeter = new Greeter('world');

const button = document.getElementById('myButton')!;
button.onclick = () => {
  alert(greeter.greet());
};
