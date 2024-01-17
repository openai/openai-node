import OpenAI from 'openai';

const client = new OpenAI();

async function typeTests() {
  const response = await client.audio.transcriptions
    .create({
      file: 'test' as any,
      model: 'whisper-1',
    })
    .asResponse();
  // @ts-expect-error this doesn't work with "moduleResolution": "node"
  response.body;
}
