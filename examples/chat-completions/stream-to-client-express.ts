#!/usr/bin/env -S npm run tsn -- -T

// This file demonstrates how to stream from the server the chunks as
// a new-line separated JSON-encoded stream.
// This server is for local development and binds only to 127.0.0.1 by default.
// To deliberately expose it to another network, require bearer authentication:
//
//   OPENAI_EXAMPLE_HOST=0.0.0.0 OPENAI_EXAMPLE_ALLOW_REMOTE=true \
//     OPENAI_EXAMPLE_AUTH_TOKEN="$(openssl rand -hex 32)" npm run tsn -- -T \
//     examples/chat-completions/stream-to-client-express.ts
//
// Remote requests must include: Authorization: Bearer <OPENAI_EXAMPLE_AUTH_TOKEN>

import { timingSafeEqual } from 'node:crypto';
import OpenAI from 'openai';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';

const bindHost = process.env['OPENAI_EXAMPLE_HOST'] ?? '127.0.0.1';
const isLoopback = bindHost === '127.0.0.1' || bindHost === '::1' || bindHost === 'localhost';
const authToken = process.env['OPENAI_EXAMPLE_AUTH_TOKEN'];

if (!isLoopback) {
  if (process.env['OPENAI_EXAMPLE_ALLOW_REMOTE'] !== 'true') {
    throw new Error('Non-loopback binding requires OPENAI_EXAMPLE_ALLOW_REMOTE=true');
  }
  if (!authToken || authToken.trim().length < 32) {
    throw new Error('Non-loopback binding requires an OPENAI_EXAMPLE_AUTH_TOKEN of at least 32 characters');
  }
}

const openai = new OpenAI();
const app = express();

if (!isLoopback) {
  const expectedAuthorization = Buffer.from(`Bearer ${authToken}`);

  app.use((req: Request, res: Response, next: NextFunction): void => {
    const authorization = Buffer.from(req.get('authorization') ?? '');
    if (
      authorization.length !== expectedAuthorization.length ||
      !timingSafeEqual(authorization, expectedAuthorization)
    ) {
      res.status(401).set('WWW-Authenticate', 'Bearer').send('Unauthorized');
      return;
    }
    next();
  });
}

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

app.listen(3000, bindHost, () => {
  console.log(`Started development proxy express server on ${bindHost}:3000`);
});
