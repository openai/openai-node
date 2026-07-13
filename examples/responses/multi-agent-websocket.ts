#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';
import { ResponsesWS } from 'openai/resources/beta/responses/ws';

const client = new OpenAI();

const input = `Proposal Alpha: launch in 2 weeks for $40k using a managed vendor with a 99.9% SLA; data leaves our VPC.
Proposal Beta: launch in 6 weeks for $70k using a self-hosted system with a 99.5% target; data stays in our VPC.
Delegate each proposal to a separate agent, then compare speed, cost, reliability, and security and recommend one.`;

async function main() {
  const ws = new ResponsesWS(client, {
    headers: { 'OpenAI-Beta': 'responses_multi_agent=v1' },
  });

  ws.send({
    type: 'response.create',
    model: 'gpt-5.6-sol',
    input,
    multi_agent: { enabled: true },
  });

  const agents = new Map<string, string>();
  let currentItemID: string | undefined;
  for await (const message of ws) {
    if (message.type === 'error') throw message.error;
    if (message.type !== 'message') continue;

    const event = message.message;
    if (event.type === 'response.output_item.added' && event.item.type === 'message') {
      agents.set(event.item.id, event.item.agent?.agent_name ?? '/root');
    } else if (event.type === 'response.output_text.delta') {
      if (currentItemID !== event.item_id) {
        const separator = currentItemID === undefined ? '' : '\n\n';
        currentItemID = event.item_id;
        const name = agents.get(event.item_id) ?? '/root';
        const role = name === '/root' ? 'Coordinator' : 'Agent';
        process.stdout.write(`${separator}━━━ ${role}: ${name} ━━━\n\n`);
      }
      process.stdout.write(event.delta);
    } else if (event.type === 'response.completed') {
      process.stdout.write('\n');
      ws.close();
      break;
    }
  }
}

main();
