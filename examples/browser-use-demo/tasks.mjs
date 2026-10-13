import { readFile } from 'node:fs/promises';

export const tasks = JSON.parse(await readFile(new URL('tasks.json', import.meta.url), 'utf-8'));

/** Verification reads browser outcomes and compares them with the synthetic task specification. */
export async function inspectTask(page, taskId, business) {
  if (business) {
    return business.snapshot();
  }
  const state = await page.locator('body').evaluate((body) => ({
    revision: Number(body.dataset.revision),
    finished: body.dataset.finished === 'true',
    results: JSON.parse(body.dataset.results),
    fields: Object.fromEntries(
      [...body.querySelectorAll('input,select')].map((field) => [
        field.getAttribute('aria-label'),
        field.value,
      ]),
    ),
  }));
  const task = tasks[taskId];
  state.verified =
    taskId === 'reservation'
      ? state.results.confirmation === 'TABLE-204' &&
        Object.entries(task.fields).every(([name, value]) => state.fields[name] === value)
      : state.results.length === task.items.length &&
        task.items.every(
          (item, index) =>
            state.results[index]?.id === item.id && state.results[index]?.choice === item.expected,
        );
  return state;
}
