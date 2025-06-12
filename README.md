# openai-node

A Node.js client library for interacting with the OpenAI API, designed for easy integration, extensibility, and robust handling of common OpenAI use cases.

## Features

- Simple, promise-based API for calling OpenAI endpoints (chat, completions, images, embeddings, etc.)
- TypeScript support (types included)
- Automatic retries and error handling
- Streamed response support
- Easily configurable for different API keys and OpenAI-compatible endpoints
- Lightweight with minimal dependencies

## Installation

```bash
npm install openai-node
# or
yarn add openai-node
```

## Usage

### Basic Example

```js
const { OpenAI } = require('openai-node');
const openai = new OpenAI({ apiKey: 'YOUR_OPENAI_API_KEY' });

async function run() {
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'Hello, OpenAI!' }],
  });
  console.log(response.choices[0].message.content);
}

run();
```

### Using TypeScript

```typescript
import { OpenAI } from 'openai-node';

const openai = new OpenAI({ apiKey: 'YOUR_OPENAI_API_KEY' });

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'What is the weather today?' }],
});

console.log(response.choices[0].message.content);
```

### Streaming Responses

```js
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## API Reference

- All OpenAI endpoints are available under the main `openai` instance:
  - `openai.chat.completions`
  - `openai.completions`
  - `openai.images`
  - `openai.embeddings`
  - And more...

See [OpenAI API docs](https://platform.openai.com/docs/api-reference/introduction) for endpoint details.

## Configuration

```js
const openai = new OpenAI({
  apiKey: 'YOUR_OPENAI_API_KEY',
  baseURL: 'https://api.openai.com/v1', // or custom
  timeout: 30000, // optional
});
```

## Error Handling

All methods throw on failure, so use `try/catch` or `.catch()`.

```js
try {
  const response = await openai.completions.create({ ... });
} catch (err) {
  console.error('OpenAI API error:', err);
}
```

## Security

- **Never commit your API keys to source control.**
- Use environment variables or secure vaults for API key management.
- Consider rate limiting and error handling to avoid leaking sensitive usage data.

## Development

- Clone the repo:  
  `git clone https://github.com/nodoubtz/openai-node.git`
- Install dependencies:  
  `npm install`
- Run tests:  
  `npm test`

## Contributing

Pull requests are welcome! Please open issues to report bugs or propose features.

## License

MIT

---

**Disclaimer:** This is an unofficial Node.js client for OpenAI. Use at your own risk.
