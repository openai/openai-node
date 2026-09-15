#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';

const client = new OpenAI();

const main = async () => {
  const partialImages = 3;
  const stream = await client.images.generate({
    model: 'gpt-image-1',
    prompt: 'A cute baby sea otter',
    n: 1,
    size: '1024x1024',
    stream: true,
    partial_images: partialImages,
  });

  let receivedFinalImage = false;
  for await (const event of stream) {
    let filename: string;
    let imageBuffer: Buffer;
    switch (event.type) {
      case 'image_generation.partial_image': {
        const index = event.partial_image_index;
        if (!Number.isInteger(index) || index < 0 || index >= partialImages) {
          throw new Error('Invalid partial image index.');
        }
        console.log(`  Partial image ${index + 1}/${partialImages} received`);
        console.log(`   Size: ${event.b64_json.length} characters (base64)`);

        // Save partial image to file
        filename = `partial_${index + 1}.png`;
        imageBuffer = Buffer.from(event.b64_json, 'base64');
        fs.writeFileSync(filename, imageBuffer);
        console.log(`   💾 Saved to: ${path.resolve(filename)}`);
        break;
      }
      case 'image_generation.completed': {
        console.log(`\n✅ Final image completed!`);
        console.log(`   Size: ${event.b64_json.length} characters (base64)`);

        // Save final image to file
        filename = 'final_image.png';
        imageBuffer = Buffer.from(event.b64_json, 'base64');
        fs.writeFileSync(filename, imageBuffer);
        receivedFinalImage = true;
        console.log(`    Saved to: ${path.resolve(filename)}`);
        break;
      }
      default: {
        console.log(`❓ Unknown event: ${event}`);
      }
    }
  }

  if (!receivedFinalImage) {
    throw new Error('Image stream ended without a final image.');
  }
};

main().catch((error) => {
  console.error('Error generating image:', error);
  process.exitCode = 1;
});
