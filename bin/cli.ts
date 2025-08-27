#!/usr/bin/env -S npx tsx

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Try to load the OpenAI client
let OpenAI: any;
try {
  OpenAI = require('../dist/client').OpenAI;
} catch (e) {
  // Fallback for development
  try {
    OpenAI = require('../src/client').OpenAI;
  } catch (e2) {
    console.error('Error: Could not load OpenAI client. Make sure to run "yarn build" first.');
    process.exit(1);
  }
}

interface Command {
  description: string;
  fn: () => void | Promise<void>;
}

const commands: Record<string, Command> = {
  migrate: {
    description: 'Run migrations to update to the latest major SDK version',
    fn: () => {
      const result = spawnSync(
        'npx',
        [
          '-y',
          'https://github.com/stainless-api/migrate-ts/releases/download/0.0.3/stainless-api-migrate-0.0.3.tgz',
          '--migrationConfig',
          require.resolve('./migration-config.json'),
          ...process.argv.slice(3),
        ],
        { stdio: 'inherit' },
      );
      if (result.status !== 0) {
        process.exit(result.status);
      }
    },
  },
  'validate-key': {
    description: 'Validate your OpenAI API key',
    fn: async () => {
      try {
        const client = new OpenAI();
        const models = await client.models.list();
        console.log('✅ API key is valid!');
        console.log(`📊 You have access to ${models.data.length} models`);
        process.exit(0);
      } catch (error: any) {
        console.error('❌ API key validation failed:');
        if (error.status === 401) {
          console.error('   Invalid API key. Please check your OPENAI_API_KEY environment variable.');
        } else if (error.status === 429) {
          console.error('   Rate limit exceeded. Please try again later.');
        } else {
          console.error(`   ${error.message}`);
        }
        process.exit(1);
      }
    },
  },
  'models': {
    description: 'List available models',
    fn: async () => {
      try {
        const client = new OpenAI();
        const models = await client.models.list();
        
        console.log('🤖 Available Models:');
        console.log('');
        
        const modelGroups: Record<string, any[]> = {};
        models.data.forEach((model: any) => {
          const group = model.id.split('-')[0] || 'other';
          if (!modelGroups[group]) modelGroups[group] = [];
          modelGroups[group].push(model);
        });
        
        Object.entries(modelGroups).forEach(([group, groupModels]) => {
          console.log(`📁 ${group.toUpperCase()}:`);
          groupModels.forEach((model: any) => {
            const status = model.deprecated ? '⚠️  (deprecated)' : '✅';
            console.log(`   ${status} ${model.id}`);
          });
          console.log('');
        });
        
        console.log(`Total: ${models.data.length} models`);
      } catch (error: any) {
        console.error('❌ Failed to fetch models:', error.message);
        process.exit(1);
      }
    },
  },
  'chat': {
    description: 'Quick chat with OpenAI models',
    fn: async () => {
      const args = process.argv.slice(3);
      if (args.length === 0) {
        console.error('❌ Please provide a message to send.');
        console.error('Usage: openai chat "your message here"');
        process.exit(1);
      }
      
      const message = args.join(' ');
      const model = process.env.OPENAI_MODEL || 'gpt-4o';
      
      try {
        console.log(`🤖 Chatting with ${model}...`);
        console.log(`💬 You: ${message}`);
        console.log('');
        
        const client = new OpenAI();
        const completion = await client.chat.completions.create({
          model: model,
          messages: [{ role: 'user', content: message }],
          max_tokens: 1000,
        });
        
        const response = completion.choices[0]?.message?.content;
        console.log(`🤖 Assistant: ${response}`);
      } catch (error: any) {
        console.error('❌ Chat failed:', error.message);
        process.exit(1);
      }
    },
  },
  'upload': {
    description: 'Upload a file to OpenAI',
    fn: async () => {
      const args = process.argv.slice(3);
      if (args.length === 0) {
        console.error('❌ Please provide a file path to upload.');
        console.error('Usage: openai upload <file-path>');
        process.exit(1);
      }
      
      const filePath = args[0];
      
      if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
      }
      
      try {
        console.log(`📤 Uploading ${filePath}...`);
        
        const client = new OpenAI();
        const file = await client.files.create({
          file: fs.createReadStream(filePath),
          purpose: 'assistants',
        });
        
        console.log('✅ File uploaded successfully!');
        console.log(`📁 File ID: ${file.id}`);
        console.log(`📄 Filename: ${file.filename}`);
        console.log(`📊 Size: ${(file.bytes / 1024).toFixed(2)} KB`);
        console.log(`📋 Purpose: ${file.purpose}`);
        console.log(`⏰ Created: ${new Date(file.created_at * 1000).toLocaleString()}`);
      } catch (error: any) {
        console.error('❌ Upload failed:', error.message);
        process.exit(1);
      }
    },
  },
  'usage': {
    description: 'Get your OpenAI API usage statistics',
    fn: async () => {
      try {
        const client = new OpenAI();
        
        // Get current date and first day of current month
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        
        console.log('📊 OpenAI API Usage Statistics');
        console.log('==============================');
        console.log('');
        
        // Note: OpenAI doesn't have a direct usage endpoint in the current API
        // This is a placeholder for when usage endpoints become available
        console.log('ℹ️  Usage statistics are not yet available through the API.');
        console.log('   You can check your usage at: https://platform.openai.com/usage');
        console.log('');
        console.log('📅 Current period:');
        console.log(`   From: ${firstDay.toLocaleDateString()}`);
        console.log(`   To: ${now.toLocaleDateString()}`);
        console.log('');
        console.log('💡 Tip: Set up usage alerts in your OpenAI dashboard to monitor costs.');
        
      } catch (error: any) {
        console.error('❌ Failed to fetch usage:', error.message);
        process.exit(1);
      }
    },
  },
};

function exitWithHelp() {
  console.log(`Usage: openai <subcommand>`);
  console.log();
  console.log('Available commands:');

  for (const [name, info] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(15)} ${info.description}`);
  }

  console.log();
  console.log('Examples:');
  console.log('  openai validate-key                    # Check if your API key is valid');
  console.log('  openai models                         # List all available models');
  console.log('  openai chat "Hello, how are you?"     # Quick chat with GPT-4o');
  console.log('  openai upload document.txt            # Upload a file');
  console.log('  openai usage                          # Check API usage');
  console.log('  openai migrate ./src                  # Migrate your code');
  console.log();
  process.exit(1);
}

if (process.argv.length < 3) {
  exitWithHelp();
}

const commandName = process.argv[2];

const command = commands[commandName];
if (!command) {
  console.log(`❌ Unknown subcommand: ${commandName}`);
  console.log();
  exitWithHelp();
}

// Handle async commands
if (command.fn.constructor.name === 'AsyncFunction') {
  (command.fn as () => Promise<void>)().catch((error: any) => {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  });
} else {
  command.fn();
}
