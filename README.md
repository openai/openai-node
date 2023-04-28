# Azure OpenAI NodeJS Library

This is a fork of the official [OpenAI Node.js library](https://github.com/openai/openai-node) that has been adapted to support the Azure OpenAI API. The objective of this library is to minimize the changes required to migrate from the official OpenAI library to Azure OpenAI or revert back to OpenAI.

> **Note**
> It is also an inofficial fork of [1openwindow/azure-openai-node](https://github.com/1openwindow/azure-openai-node) which we could not use due to due diligence reasons 🥇 

This library allows you to use Azure OpenAI's API without making any changes to your existing OpenAI code. You can simply add Azure information to your configuration and start using the Azure OpenAI model.

## Installation

```bash
$ npm install @unique-ag/openai
```

## Usage

The library must be configured with your Azure OpenAI's `key`, `endpoint`, and `deploymentId`. You can obtain these credentials from [Azure Portal](https://portal.azure.com).

```ts
import { Configuration, OpenAIApi } from '@unique-ag/openai';

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(
  new Configuration({
    apiKey: this.apiKey,
    // add azure info into configuration
    azure: {
      apiKey: <key1>
      endpoint: <endpoint>,
    // The `deploymentName` parameter is optional; if you do not set it, you need to put it in the request parameter
      deploymentName: <model-deployment-name>,
      apiVerison: '2023-03-15-preview' // or other version
    }
  )
);

const completion = await openai.createCompletion({
  model: "text-davinci-003",
  prompt: "Hello world",
});

console.log(completion.data.choices[0].text);

```

## Variations
### Streaming
Azure OpenAI does not response delta data, so you need to change the response to text
```ts
// before: const delta = parsed.choices[0].delta.content;
const delta = parsed.choices[0].text;
```

### Deployment name
```ts
const response = await this.openAiApi.createCompletion({
  model: <deployement>,
  prompt: prompt,
  maxTokens: 100,
  temperature: 0.9,
  topP: 1,
  presencePenalty: 0,
  frequencyPenalty: 0,
  bestOf: 1,
});
```

## Releases

This library follows the versioning and releases of the official OpenAI node library.