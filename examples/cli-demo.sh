#!/bin/bash

# OpenAI CLI Demo Script
# This script demonstrates the new CLI features

echo "🚀 OpenAI CLI Demo"
echo "=================="
echo ""

# Check if API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Please set your OPENAI_API_KEY environment variable first:"
    echo "   export OPENAI_API_KEY='your-api-key-here'"
    exit 1
fi

echo "1️⃣  Validating API key..."
openai validate-key
echo ""

echo "2️⃣  Listing available models..."
openai models
echo ""

echo "3️⃣  Quick chat example..."
openai chat "What's the capital of France?"
echo ""

echo "4️⃣  Usage information..."
openai usage
echo ""

echo "5️⃣  File upload example (creating a test file first)..."
echo "Hello, this is a test file for the OpenAI CLI demo!" > demo-file.txt
openai upload demo-file.txt
echo ""

echo "6️⃣  Cleaning up..."
rm -f demo-file.txt
echo "✅ Demo completed!"
echo ""
echo "💡 Try these commands on your own:"
echo "   openai chat 'Explain quantum computing'"
echo "   openai models"
echo "   openai validate-key"
echo ""
