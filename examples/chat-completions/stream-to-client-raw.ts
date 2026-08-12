#!/usr/bin/env -S npm run tsn -- -T

// This file demonstrates how to stream from the server as a text/plain
// response with express and the stream async iterator.

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
//     const decoder = new TextDecoder();
//     for await (const chunk of res.body) {
//       console.log(`chunk: ${decoder.decode(chunk)}`);
//     }
//   })
//
const handleRequest = async (req: Request, res: Response) => {
  console.log('Received request:', req.body);

  const stream = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    stream: true,
    messages: [{ role: 'user', content: req.body }],
  });

  res.header('Content-Type', 'text/plain');

  // Sends each content stream chunk-by-chunk, such that the client
  // ultimately receives a single string.
  for await (const chunk of stream) {
    res.write(chunk.choices[0]?.delta.content || '');
  }

  res.end();
};

app.post('/', (req: Request, res: Response) => handleRequest(req, res).catch(console.error));

app.listen('3000', () => {
  console.log('Started proxy express server');
});
