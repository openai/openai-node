import OpenAI from "openai";

const client = new OpenAI();

let conversation = [];

function preservePairs(output) {
  const result = [];

  for (let i = 0; i < output.length; i++) {
    const curr = output[i];
    const next = output[i + 1];

    if (curr.type === "reasoning" && next?.type === "message") {
      result.push(curr, next);
      i++;
    }
  }

  return result;
}

async function run() {
  for (const msg of [
    "Write a Python prime checker.",
    "Add type hints.",
    "Add docstrings."
  ]) {
    conversation.push({ role: "user", content: msg });

    const response = await client.responses.create({
      model: "gpt-5.3-codex",
      input: conversation,
      reasoning: { effort: "high" },
    });

    // ✅ SAFE
    conversation.push(...preservePairs(response.output));
  }
}

run();