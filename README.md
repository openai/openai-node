# Martian Node API library

The Martin Node library is a drop in replacement for OpenAI package

## Documentation

The API documentation can be found [here](https://docs.withmartian.com/).

## Installation

```sh
npm i martian-node
```

## Usage

```ts
import OpenAI from 'martian-node';

const openai = new OpenAI({
  apiKey: 'My Martian API Key', // defaults to process.env["MARTIAN_API_KEY"]
});

async function main() {
  // Argument model is optional, but it could also be single model or list of models
  const chatCompletion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: 'Say this is a test' }],
    // model: 'gpt-3.5-turbo' // Optional argument, router chooses the best model for you
    // model: ['gpt-3.5-turbo', 'claude-v1'], // If more than one is specified, the router chooses the best among them
  });
}

main();
```
