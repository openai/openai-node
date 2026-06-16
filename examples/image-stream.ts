#!/usr/bin/env -S npm run tsn -T

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const client = new OpenAI();

const main = async () => {
  const stream = await client.images.generate({
    model: 'gpt-image-1',
    prompt: 'A cute baby sea otter',
    n: 1,
    size: '1024x1024',
    stream: true,
    partial_images: 3,
  });

  for await (const event of stream) {
    let filename: string;
    let imageBuffer: Buffer;
    switch (event.type) {
      case 'image_generation.partial_image':
        console.log(`  Partial image ${event.partial_image_index + 1}/3 received`);
        console.log(`   Size: ${event.b64_json.length} characters (base64)`);

        // Save partial image to file
        filename = `partial_${event.partial_image_index + 1}.png`;
        imageBuffer = Buffer.from(event.b64_json, 'base64');
        fs.writeFileSync(filename, imageBuffer);
        console.log(`   💾 Saved to: ${path.resolve(filename)}`);
        break;
      case 'image_generation.completed':
        console.log(`\n✅ Final image completed!`);
        console.log(`   Size: ${event.b64_json.length} characters (base64)`);

        // Save final image to file
        filename = 'final_image.png';
        imageBuffer = Buffer.from(event.b64_json, 'base64');
        fs.writeFileSync(filename, imageBuffer);
        console.log(`    Saved to: ${path.resolve(filename)}`);
        break;
      default:
        console.log(`❓ Unknown event: ${event}`);
    }
  }
};

main().catch((error) => {
  console.error('Error generating image:', error);
});
