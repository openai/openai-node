#!/usr/bin/env -S npm run tsn -- -T

import fs from 'fs';
import path from 'path';
import OpenAI, { toFile } from 'openai';

const openai = new OpenAI();
const inputImages = process.argv.slice(2);

/**
 * Run without arguments to generate an image:
 *
 *   ./examples/picture.ts
 *
 * Pass one or more PNG, JPEG, or WebP files to create an edited image:
 *
 *   ./examples/picture.ts image-1.png image-2.png
 */
async function main() {
  if (inputImages.length === 0) {
    await createImage();
  } else {
    await createImageEdit(inputImages);
  }
}

async function createImage() {
  const response = await openai.images.generate({
    model: 'gpt-image-2',
    prompt: 'An astronaut lounging in a tropical resort in space, pixel art',
    size: '1024x1024',
  });

  await saveImage('generated.png', response.data?.[0]?.b64_json);
}

async function createImageEdit(imageFiles: string[]) {
  const images = await Promise.all(
    imageFiles.map(async (file) => {
      const type = imageContentType(file);
      return await toFile(fs.createReadStream(file), path.basename(file), { type });
    }),
  );

  const response = await openai.images.edit({
    model: 'gpt-image-2',
    image: images,
    prompt: 'Create a lovely gift basket with the items from the input images',
  });

  await saveImage('edited.png', response.data?.[0]?.b64_json);
}

function imageContentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error(`Unsupported image type for ${file}. Use a PNG, JPEG, or WebP file.`);
  }
}

async function saveImage(filename: string, imageBase64: string | undefined) {
  if (!imageBase64) {
    throw new Error('The API response did not include image data.');
  }

  const outputPath = path.resolve(filename);
  await fs.promises.writeFile(outputPath, Buffer.from(imageBase64, 'base64'));
  console.log(`Saved image to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
