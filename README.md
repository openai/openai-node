# OpenAI Node.js Library

The OpenAI Node.js library provides convenient access to the OpenAI API from Node.js applications. Most of the code in this library is generated from our [OpenAPI specification](https://github.com/openai/openai-openapi).

**Important note: this library is meant for server-side usage only, as using it in client-side browser code will expose your secret API key. [See here](https://platform.openai.com/docs/api-reference/authentication) for more details.**

## Installation

```bash
npm install openai
```

## Usage

The library needs to be configured with your account's secret key, which is available on the [website](https://platform.openai.com/account/api-keys). We recommend setting it as an environment variable. Here's an example of initializing the library with the API key loaded from an environment variable and creating a completion:

```javascript
const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const chatCompletion = await openai.createChatCompletion({
  model: "gpt-3.5-turbo",
  messages: [{role: "user", content: "Hello world"}],
});
console.log(completion.data.choices[0].message);
```

Check out the [full API documentation](https://platform.openai.com/docs/api-reference?lang=node.js) for examples of all the available functions.

### Request options

All of the available API request functions additionally contain an optional final parameter where you can pass custom [axios request options](https://axios-http.com/docs/req_config), for example:

```javascript
const completion = await openai.createCompletion(
  {
    model: "text-davinci-003",
    prompt: "Hello world",
  },
  {
    timeout: 1000,
    headers: {
      "Example-Header": "example",
    },
  }
);
```

### Error handling

API requests can potentially return errors due to invalid inputs or other issues. These errors can be handled with a `try...catch` statement, and the error details can be found in either `error.response` or `error.message`:

```javascript
try {
  const completion = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: "Hello world",
  });
  console.log(completion.data.choices[0].text);
} catch (error) {
  if (error.response) {
    console.log(error.response.status);
    console.log(error.response.data);
  } else {
    console.log(error.message);
  }
}
```

### Streaming completions

Streaming completions (`stream=true`) are not natively supported in this package yet, but [a workaround exists](https://github.com/openai/openai-node/issues/18#issuecomment-1369996933) if needed.

## Upgrade guide

All breaking changes for major version releases are listed below.

### 3.0.0

- The function signature of `createCompletion(engineId, params)` changed to `createCompletion(params)`. The value previously passed in as the `engineId` argument should now be passed in as `model` in the params object (e.g. `createCompletion({ model: "text-davinci-003", ... })`)
- Replace any `createCompletionFromModel(params)` calls with `createCompletion(params)`

## Thanks

Thank you to [ceifa](https://github.com/ceifa) for creating and maintaining the original unofficial `openai` npm package before we released this official library! ceifa's original package has been renamed to [gpt-x](https://www.npmjs.com/package/gpt-x).
