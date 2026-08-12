#!/usr/bin/env -S npm run tsn -- -T

import OpenAI from 'openai';

const client = new OpenAI();

const input = `Proposal Alpha: launch in 2 weeks for $40k using a managed vendor with a 99.9% SLA; data leaves our VPC.
Proposal Beta: launch in 6 weeks for $70k using a self-hosted system with a 99.5% target; data stays in our VPC.
Delegate each proposal to a separate agent, then compare speed, cost, reliability, and security and recommend one.`;

async function main() {
  const stream = await client.beta.responses.create({
    model: 'gpt-5.6-sol',
    input,
    multi_agent: { enabled: true },
    stream: true,
    betas: ['responses_multi_agent=v1'],
  });

  const agents = new Map<string, string>();
  let currentItemID: string | undefined;
  for await (const event of stream) {
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
    }
  }
  process.stdout.write('\n');
}

main();
