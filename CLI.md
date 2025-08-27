# OpenAI CLI

The OpenAI Node.js library includes a powerful command-line interface (CLI) that makes it easy to interact with the OpenAI API directly from your terminal.

## Installation

The CLI is automatically installed when you install the `openai` package:

```bash
npm install openai
```

## Usage

```bash
openai <command> [options]
```

## Available Commands

### `openai validate-key`

Validates your OpenAI API key by making a test request to the API.

```bash
openai validate-key
```

**Example output:**
```
✅ API key is valid!
📊 You have access to 45 models
```

**Error handling:**
- Invalid API key: Shows helpful error message
- Rate limit exceeded: Suggests trying again later
- Network errors: Displays the specific error message

### `openai models`

Lists all available models, organized by model family.

```bash
openai models
```

**Example output:**
```
🤖 Available Models:

📁 GPT:
   ✅ gpt-4o
   ✅ gpt-4o-mini
   ✅ gpt-4-turbo
   ✅ gpt-4
   ⚠️  (deprecated) gpt-4-0314

📁 GPT-3.5:
   ✅ gpt-3.5-turbo
   ✅ gpt-3.5-turbo-16k

📁 DALL-E:
   ✅ dall-e-3
   ✅ dall-e-2

📁 WHISPER:
   ✅ whisper-1

Total: 45 models
```

### `openai chat`

Quick chat with any OpenAI model. Perfect for testing or simple conversations.

```bash
openai chat "Your message here"
```

**Features:**
- Uses GPT-4o by default (configurable via `OPENAI_MODEL` environment variable)
- Supports multi-word messages
- Limited to 1000 tokens for quick responses
- Clear conversation format

**Example:**
```bash
openai chat "What's the capital of France?"
```

**Output:**
```
🤖 Chatting with gpt-4o...
💬 You: What's the capital of France?

🤖 Assistant: The capital of France is Paris.
```

### `openai upload`

Upload files to OpenAI for use with assistants or other features.

```bash
openai upload <file-path>
```

**Features:**
- Validates file existence before upload
- Shows detailed upload information
- Supports any file type accepted by OpenAI
- Uses 'assistants' purpose by default

**Example:**
```bash
openai upload document.txt
```

**Output:**
```
📤 Uploading document.txt...
✅ File uploaded successfully!
📁 File ID: file-abc123
📄 Filename: document.txt
📊 Size: 15.23 KB
📋 Purpose: assistants
⏰ Created: 12/19/2023, 2:30:45 PM
```

### `openai usage`

Get information about your OpenAI API usage (placeholder for future API endpoints).

```bash
openai usage
```

**Output:**
```
📊 OpenAI API Usage Statistics
==============================

ℹ️  Usage statistics are not yet available through the API.
   You can check your usage at: https://platform.openai.com/usage

📅 Current period:
   From: 12/1/2023
   To: 12/19/2023

💡 Tip: Set up usage alerts in your OpenAI dashboard to monitor costs.
```

### `openai migrate`

Migrate your code to the latest major SDK version.

```bash
openai migrate <directory>
```

**Example:**
```bash
openai migrate ./src
```

## Environment Variables

The CLI respects the same environment variables as the main library:

- `OPENAI_API_KEY` - Your OpenAI API key (required)
- `OPENAI_MODEL` - Default model for chat command (defaults to 'gpt-4o')
- `OPENAI_BASE_URL` - Custom base URL for the API
- `OPENAI_ORG_ID` - Your OpenAI organization ID

## Development

For development, you can use the TypeScript version of the CLI:

```bash
yarn cli:dev validate-key
```

Or run the built version:

```bash
yarn cli validate-key
```

## Error Handling

All commands include comprehensive error handling:

- **Network errors**: Clear error messages with retry suggestions
- **Authentication errors**: Helpful guidance for API key issues
- **Rate limiting**: Automatic retry logic with exponential backoff
- **File errors**: Validation before attempting operations
- **API errors**: Specific error messages for different failure types

## Examples

Here are some practical examples of how to use the CLI:

### Quick API Key Test
```bash
# Test if your API key is working
openai validate-key
```

### List Available Models
```bash
# See all models you have access to
openai models
```

### Quick Chat Session
```bash
# Ask a quick question
openai chat "Explain quantum computing in simple terms"

# Use a specific model
OPENAI_MODEL=gpt-4o-mini openai chat "What's 2+2?"
```

### File Management
```bash
# Upload a document for use with assistants
openai upload my-document.pdf

# Upload multiple files
openai upload file1.txt
openai upload file2.txt
```

### Code Migration
```bash
# Migrate your entire project
openai migrate .

# Migrate specific directories
openai migrate ./src ./lib
```

## Tips and Best Practices

1. **Set up your API key**: Make sure `OPENAI_API_KEY` is set in your environment
2. **Use quotes for chat messages**: Wrap multi-word messages in quotes
3. **Check file paths**: Ensure files exist before uploading
4. **Monitor usage**: Use the usage command to track your API consumption
5. **Use specific models**: Set `OPENAI_MODEL` for consistent model usage

## Contributing

The CLI is designed to be extensible. New commands can be easily added by:

1. Adding a new command to the `commands` object in `bin/cli.ts`
2. Implementing the command logic
3. Adding appropriate error handling
4. Updating this documentation

## Troubleshooting

### Common Issues

**"Could not load OpenAI client"**
- Run `yarn build` to build the library first
- Ensure you're in the correct directory

**"API key validation failed"**
- Check that `OPENAI_API_KEY` is set correctly
- Verify the API key is valid in your OpenAI dashboard

**"File not found"**
- Ensure the file path is correct
- Use absolute paths if needed

**"Rate limit exceeded"**
- Wait a moment and try again
- Check your usage limits in the OpenAI dashboard

### Getting Help

For issues with the CLI:
1. Check the error messages for specific guidance
2. Verify your environment variables are set correctly
3. Try running with verbose logging if available
4. Check the main library documentation for API-specific issues
