#!/usr/bin/env -S npm run tsn -- -T

// This file demonstrates how to stream from the server the chunks as
// a new-line separated JSON-encoded stream.

import OpenAI from 'openai';
import type { Request, Response } from 'express';
import express from 'express';

const openai = new OpenAI();
const app = express();

app.use(express.text());

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
// See examples/chat-completions/stream-to-client-browser.ts for a more complete example.
const handleRequest = async (req: Request, res: Response) => {
  console.log('Received request:', req.body);

  const stream = openai.chat.completions.stream({
    model: 'gpt-3.5-turbo',
    stream: true,
    messages: [{ role: 'user', content: req.body }],
  });

  res.header('Content-Type', 'text/plain');
  for await (const chunk of stream.toReadableStream()) {
    res.write(chunk);
  }

  res.end();
};

app.post('/', (req: Request, res: Response) => handleRequest(req, res).catch(console.error));

app.listen('3000', () => {
  console.log('Started proxy express server');
});
