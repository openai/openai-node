import OpenAI from 'openai';

const client = new OpenAI();

async function typeTests() {
  const response = await client.audio.transcriptions
    .create({
      // SAFETY: This compile-only resolution fixture does not send a request; the placeholder bypasses upload construction to check the package entry point.
      file: 'test' as any,
      model: 'whisper-1',
    })
    .asResponse();
  return response.body;
}
