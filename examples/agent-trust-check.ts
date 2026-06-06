#!/usr/bin/env -S npm run tsn -T
/**
 * Example: verify agent trust before taking action with OpenAI
 *
 * Calls the TWZRD Agent Intel MCP server (https://intel.twzrd.xyz) to score
 * an AI agent wallet, then passes the trust result to OpenAI to decide
 * whether to proceed. Uses the MCP TypeScript SDK as a lightweight client.
 *
 * Install:
 *   npm install @modelcontextprotocol/sdk
 *
 * Run:
 *   OPENAI_API_KEY=sk-... yarn tsn -T examples/agent-trust-check.ts
 */

import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const openai = new OpenAI(); // reads OPENAI_API_KEY from env

const AGENT_WALLET = 'D1QkbFJKiPsymJ65RKHhF6DFB8sPMfpBaFBzuHKfJGWi'; // example wallet

const main = async () => {
  // 1. Call TWZRD Agent Intel MCP server directly
  const transport = new StreamableHTTPClientTransport(new URL('https://intel.twzrd.xyz/mcp'));
  const mcpClient = new Client({ name: 'openai-example', version: '1.0.0' });
  await mcpClient.connect(transport);

  const trustResult = await mcpClient.callTool({
    name: 'preflight_check',
    arguments: { wallet: AGENT_WALLET },
  });
  await mcpClient.close();

  const trustSummary = JSON.stringify(trustResult.content);

  // 2. Feed trust result to OpenAI for a decision
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a security gate for an autonomous agent pipeline. Based on a trust check result, decide whether to allow or block the agent.',
      },
      {
        role: 'user',
        content: `Wallet ${AGENT_WALLET} preflight result: ${trustSummary}\n\nShould this agent be allowed to proceed? Respond with ALLOW or BLOCK and a brief reason.`,
      },
    ],
  });

  console.log('\nDecision:', response.choices[0].message.content);
};

main();
