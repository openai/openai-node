#!/usr/bin/env -S npm run tsn -T
import OpenAI from 'openai';

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();

async function main() {
  // Generate an image based on the prompt
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt: 'An astronaut lounging in a tropical resort in space, pixel art',
  });
  console.log(response); // Log the response to the console, a URL link to image will be in the response.data[0].url
  if (response.data && response.data[0] && response.data[0].url) {
    console.log('Image URL:', response.data[0].url); // Log the image URL
  } else {
    console.log('Image URL not found in response.');
  }
}

main().catch(console.error);
