#!/usr/bin/env -S npm run tsn -- -T

// Run without credentials: pnpm tsn -T examples/responses/computer.ts
// A small caller-owned driver to demonstrate dispatch in a caller-managed loop.
// Connect the same interface to your isolated browser/VM in an application.
import { ComputerToolset } from 'openai';
import type { ComputerDriver } from 'openai';
import type { ComputerAction } from 'openai/resources/responses/responses';

async function main() {
  const actions: string[] = [];
  const record = (action: ComputerAction) => {
    actions.push(action.type);
  };
  const driver: ComputerDriver = {
    click: record,
    double_click: record,
    drag: record,
    keypress: record,
    move: record,
    scroll: record,
    type: record,
    wait: record,
    // Synthetic one-pixel PNG, no filesystem or credentials involved.
    screenshot: () => ({
      type: 'computer_screenshot',
      image_url:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YCcFh0AAAAASUVORK5CYII=',
    }),
  };
  const toolset = new ComputerToolset(driver);
  try {
    const output = await toolset.execute(
      {
        type: 'computer_call',
        id: 'cu_example',
        call_id: 'call_example',
        status: 'completed',
        pending_safety_checks: [],
        actions: [
          { type: 'click', x: 10, y: 20, button: 'left' },
          { type: 'type', text: 'hello' },
        ],
      },
      {
        beforeAction: (action) => {
          console.log('Authorizing', action.type);
          return true;
        },
      },
    );
    console.log({ actions, output });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

void main();
