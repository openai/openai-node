import { readFile } from 'node:fs/promises';

export const tasks = JSON.parse(await readFile(new URL('tasks.json', import.meta.url), 'utf-8'));

/** Verify the recorded submission and visible form values against the local brief. */
export async function inspectTask(page) {
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
  state.verified =
    state.results.confirmation === 'TABLE-204' &&
    Object.entries(tasks.reservation.fields).every(
      ([name, value]) => state.results.fields?.[name] === value && state.fields[name] === value,
    );
  return state;
}
