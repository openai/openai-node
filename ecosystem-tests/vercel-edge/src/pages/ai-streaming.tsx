import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import type { FormEvent } from 'react';

const transport = new DefaultChatTransport({ api: '/api/vercel-ai-streaming' });

export default function Chat() {
  const [input, setInput] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const { messages, sendMessage } = useChat({ transport });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim() || !accessToken.trim()) {return;}

    void sendMessage({ text: input }, { headers: { authorization: `Bearer ${accessToken.trim()}` } });
    setInput('');
  };

  return (
    <div className="mx-auto w-full max-w-md py-24 flex flex-col stretch">
      {messages.map((m) => (
        <div key={m.id}>
          {m.role === 'user' ? 'User: ' : 'AI: '}
          {m.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')}
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <label>
          Test access token
          <input
            autoComplete="off"
            onChange={(event) => setAccessToken(event.target.value)}
            type="password"
            value={accessToken}
          />
        </label>
        <label>
          Say something...
          <input
            className="fixed w-full max-w-md bottom-0 border border-gray-300 rounded mb-8 shadow-xl p-2"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
