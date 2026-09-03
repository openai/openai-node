#!/usr/bin/env -S npm run tsn -- -T

// This file demonstrates how to stream from the server as a text/plain
// response with express and the stream async iterator.
// This server is for local development and binds only to 127.0.0.1 by default.
// To deliberately expose it to another network, require HTTPS and bearer authentication:
//
//   OPENAI_EXAMPLE_HOST=0.0.0.0 OPENAI_EXAMPLE_ALLOW_REMOTE=true \
//     OPENAI_EXAMPLE_TLS_CERT_FILE=server-cert.pem \
//     OPENAI_EXAMPLE_TLS_KEY_FILE=server-key.pem \
//     OPENAI_EXAMPLE_AUTH_TOKEN="$(openssl rand -hex 32)" npm run tsn -- -T \
//     examples/chat-completions/stream-to-client-raw.ts
//
// Remote HTTPS requests must include: Authorization: Bearer <OPENAI_EXAMPLE_AUTH_TOKEN>

import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import OpenAI from 'openai';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';

const configuredHost = process.env['OPENAI_EXAMPLE_HOST'] ?? '127.0.0.1';
const bindHost = configuredHost === 'localhost' ? '127.0.0.1' : configuredHost;
const isLoopback = bindHost === '127.0.0.1' || bindHost === '::1';
const authToken = process.env['OPENAI_EXAMPLE_AUTH_TOKEN'];
const tlsCertificatePath = process.env['OPENAI_EXAMPLE_TLS_CERT_FILE'];
const tlsPrivateKeyPath = process.env['OPENAI_EXAMPLE_TLS_KEY_FILE'];

if (!isLoopback) {
  if (process.env['OPENAI_EXAMPLE_ALLOW_REMOTE'] !== 'true') {
    throw new Error('Non-loopback binding requires OPENAI_EXAMPLE_ALLOW_REMOTE=true');
  }
  if (!authToken || authToken.trim().length < 32) {
    throw new Error('Non-loopback binding requires an OPENAI_EXAMPLE_AUTH_TOKEN of at least 32 characters');
  }
  if (!tlsCertificatePath || !tlsPrivateKeyPath) {
    throw new Error(
      'Non-loopback binding requires OPENAI_EXAMPLE_TLS_CERT_FILE and OPENAI_EXAMPLE_TLS_KEY_FILE',
    );
  }
}

const app = express();
const tlsServer =
  !isLoopback && tlsCertificatePath && tlsPrivateKeyPath
    ? createServer({ cert: readFileSync(tlsCertificatePath), key: readFileSync(tlsPrivateKeyPath) }, app)
    : undefined;
const openai = new OpenAI();

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

if (isLoopback) {
  const loopbackOrigin = `http://${bindHost === '::1' ? '[::1]' : bindHost}:3000`;

  app.use((req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get('origin');
    if ((origin !== undefined && origin !== loopbackOrigin) || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).send('Forbidden');
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
//   fetch('http://127.0.0.1:3000', {
//     method: 'POST',
//     body: 'Tell me why dogs are better than cats',
//   }).then(async res => {
//     const decoder = new TextDecoder();
//     for await (const chunk of res.body) {
//       console.log(`chunk: ${decoder.decode(chunk)}`);
//     }
//   })
//
function watchClientDisconnect(req: Request, res: Response) {
  if (
    typeof AbortController !== 'function' ||
    typeof req.on !== 'function' ||
    typeof req.off !== 'function' ||
    typeof res.on !== 'function' ||
    typeof res.off !== 'function'
  ) {
    return;
  }

  const controller = new AbortController();
  const onRequestAborted = () => controller.abort();
  const onResponseClosed = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  req.on('aborted', onRequestAborted);
  res.on('close', onResponseClosed);

  return {
    signal: controller.signal,
    cleanup() {
      req.off('aborted', onRequestAborted);
      res.off('close', onResponseClosed);
    },
  };
}

function rethrowUnlessClientAbort(
  error: unknown,
  disconnect: ReturnType<typeof watchClientDisconnect>,
): void {
  const clientConstructor = openai.constructor as typeof OpenAI;

  if (!disconnect?.signal.aborted || !(error instanceof clientConstructor.APIUserAbortError)) {
    throw error;
  }
}

const handleRequest = async (req: Request, res: Response) => {
  console.log('Received request:', req.body);

  const disconnect = watchClientDisconnect(req, res);

  try {
    if (res.destroyed) {
      return;
    }

    const completionRequest = {
      model: 'gpt-3.5-turbo',
      stream: true as const,
      messages: [{ role: 'user' as const, content: req.body }],
    };
    const stream = await (disconnect
      ? openai.chat.completions.create(completionRequest, { signal: disconnect.signal })
      : openai.chat.completions.create(completionRequest));

    if (disconnect?.signal.aborted || res.destroyed) {
      return;
    }

    res.header('Content-Type', 'text/plain');

    // Sends each content stream chunk-by-chunk, such that the client
    // ultimately receives a single string.
    for await (const chunk of stream) {
      if (disconnect?.signal.aborted || res.destroyed) {
        break;
      }

      res.write(chunk.choices[0]?.delta.content || '');

      if (disconnect?.signal.aborted || res.destroyed) {
        break;
      }
    }

    if (!disconnect?.signal.aborted && !res.destroyed) {
      res.end();
    }
  } catch (error) {
    rethrowUnlessClientAbort(error, disconnect);
  } finally {
    disconnect?.cleanup();
  }
};

app.post('/', (req: Request, res: Response) =>
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Express 4 does not await async handlers; consume rejections in this synchronous route.
  handleRequest(req, res).catch((error: unknown) => {
    console.error(error);
    if (res.destroyed || res.writableEnded) {
      return;
    }
    if (res.headersSent) {
      res.destroy();
    } else {
      res.status(500).end('Internal Server Error');
    }
  }),
);

const onListening = () => {
  console.log(
    `Started ${isLoopback ? 'HTTP' : 'HTTPS'} development proxy express server on ${bindHost}:3000`,
  );
};

if (tlsServer) {
  tlsServer.listen(3000, bindHost, onListening);
} else {
  app.listen(3000, bindHost, onListening);
}
