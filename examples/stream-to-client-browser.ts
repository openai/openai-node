#!/usr/bin/env -S npm run tsn -T

/**
 * This file is intended be run from the command-line with Node
 * for easy demo purposes, but simulating use in the browser.
 *
 * To run it in a browser application, copy/paste it into a frontend application,
 * remove the 'node-fetch' import, and replace `process.stdout.write` with
 * a console.log or UI display.
 */
import fetch from 'node-fetch';
import { ChatCompletionStream } from 'openai/lib/ChatCompletionStream';

fetch('http://localhost:3000', {
  method: 'POST',
  body: 'Tell me why dogs are better than cats',
  headers: { 'Content-Type': 'text/plain' },
}).then(async (res) => {
  // @ts-ignore ReadableStream on different environments can be strange
  const runner = ChatCompletionStream.fromReadableStream(res.body);

  runner.on('content', (delta, snapshot) => {
    process.stdout.write(delta);
    // or, in a browser, you might display like this:
    // document.body.innerText += delta; // or:
    // document.body.innerText = snapshot;
  });

  console.dir(await runner.finalChatCompletion(), { depth: null });
});
