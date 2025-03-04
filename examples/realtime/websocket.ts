import { OpenAIRealtimeWebSocket } from 'openai/beta/realtime/websocket';

async function main() {
  const rt = new OpenAIRealtimeWebSocket({ model: 'gpt-4o-realtime-preview-2024-12-17' });

  // access the underlying `ws.WebSocket` instance
  rt.socket.addEventListener('open', () => {
    console.log('Connection opened!');
    rt.send({
      type: 'session.update',
      session: {
        modalities: ['text'],
        model: 'gpt-4o-realtime-preview',
      },
    });

    rt.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Say a couple paragraphs!' }],
      },
    });

    rt.send({ type: 'response.create' });
  });

  rt.on('error', (err) => {
    // in a real world scenario this should be logged somewhere as you
    // likely want to continue procesing events regardless of any errors
    throw err;
  });

  rt.on('session.created', (event) => {
    console.log('session created!', event.session);
    console.log();
  });

  rt.on('response.text.delta', (event) => process.stdout.write(event.delta));
  rt.on('response.text.done', () => console.log());

  rt.on('response.done', () => rt.close());

  rt.socket.addEventListener('close', () => console.log('\nConnection closed!'));
}

main();
