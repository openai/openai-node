#!/usr/bin/env -S npm run tsn -T
import OpenAI, { toFile } from 'openai';
import fs from 'fs';
/* 
This example shows how to generate images from text prompts, as well as how to generate an image from a prompt and an input image.

if you are working with solution 1 alone, you can remove {toFile} from the openai import on line 2.
*/

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI();
async function main() {
  // [1] Generate an image based on the prompt
  await createImage();
  // [2] Generate an image with edit based on prompt and input image
  await createImageEdit();
}
/* 
[1] The code below is used to create an image based on prompt.
  n-is the number of images to be generated, and size is the size of the image to be generated.
  size- can be one of the following: '256x256', '512x512', or '1024x1024'.
  both size and n are optional parameters, if not provided, the default values will be used.
  The generated image will be saved to a file named output.png
 */
async function createImage() {
  const img = await openai.images.generate({
    model: 'gpt-image-1', //
    prompt: 'An astronaut lounging in a tropical resort in space, pixel art',
    n: 1,
    size: '1024x1024',
  });
  // Save the image to a file, you can do console.log(img) to see the response structure
  if (img.data && img.data[0] && img.data[0].b64_json) {
    const imageBuffer = Buffer.from(img.data[0].b64_json, 'base64');
    fs.writeFileSync('output.png', imageBuffer);
  }
}
/* 
[2] The code below is used to create an image edit based on the input images and prompt.
 */
// List of image files to be used for the image edit, this should be in the same directory as this script
const imageFiles: string[] = ['bath-bomb.png', 'body-lotion.png', 'incense-kit.png', 'soap.png'];

/**
 * Processes multiple image files and converts them to File objects
 * using OpenAI's toFile utility for API compatibility
 */
async function createImageEdit(): Promise<void> {
  const images: File[] = await Promise.all(
    imageFiles.map(
      async (file: string): Promise<File> =>
        await toFile(fs.createReadStream(file), null, {
          type: 'image/png',
        }),
    ),
  );

  const img: OpenAI.Images.ImagesResponse = await openai.images.edit({
    model: 'gpt-image-1',
    image: images,
    prompt: 'Create a lovely gift basket with these four items in it',
  });

  // Save the image to a file, you can do console.log(img) to see the response structure
  if (img.data && img.data[0] && img.data[0].b64_json) {
    const imageBuffer: Buffer = Buffer.from(img.data[0].b64_json, 'base64');
    fs.writeFileSync('output2.png', imageBuffer);
  }
}

main().catch(console.error);
