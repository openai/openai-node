import OpenAI from 'openai';
import type { NextApiRequest, NextApiResponse } from 'next';

// This file demonstrates how to stream from a Next.JS server as
// a new-line separated JSON-encoded stream. This file cannot be run
// without Next.JS scaffolding.

export const runtime = 'edge';

// This endpoint can be called with:
//
//   curl 127.0.0.1:3000 -N -X POST -H 'Content-Type: text/plain' \
//     --data 'Can you explain why dogs are better than cats?'
//
// Or consumed with fetch:
//
//   fetch('http://localhost:3000', {
//     method: 'POST',
//     body: 'Tell me why dogs are better than cats',
//   }).then(async res => {
//     const runner = ChatCompletionStreamingRunner.fromReadableStream(res)
//   })
//
// See examples/stream-to-client-browser.ts for a more complete example.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const openai = new OpenAI();

  const stream = openai.beta.chat.completions.stream({
    model: 'gpt-3.5-turbo',
    stream: true,
    // @ts-ignore
    messages: [{ role: 'user', content: await req.text() }],
  });

  return res.send(stream.toReadableStream());
  // @ts-ignore -- Or, for the app router:
  return new Response(stream.toReadableStream());
}
