const openaiKey = "a valid OpenAI key"
const OpenAI = require('openai');

console.log(OpenAI)

const openai = new OpenAI({
	apiKey: openaiKey,
});
