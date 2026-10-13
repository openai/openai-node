import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { BrowserToolset } from 'openai/helpers/browser';
import { inspectCall, openInspector } from './driver-inspector.mjs';

const { values } = parseArgs({ options: { report: { type: 'string' } } });
const rows = [];
await openInspector(async ({ base, page, origin }) => {
  await base.navigate({ tab_id: null, url: `${origin}/canvas` });
  const record = await page.locator('#workspace').elementHandle();
  const canvas = await page.locator('#board').elementHandle();
  const controller = new AbortController();
  const pointer = await base.createOwnedBrowser({ record, canvases: [canvas], signal: controller.signal });
  let approve = true;
  const helper = new BrowserToolset(
    { ...base, ...pointer },
    {
      members: ['screenshot', 'hover_at', 'click_at'],
      confirm: () => approve,
    },
  );
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const [scaleX, scaleY] of [
    [1, 1],
    [2, 2],
    [0.5, 0.75],
  ]) {
    // Each gesture uses its own fresh screenshot and current CSS bounds.
    // oxlint-disable-next-line no-await-in-loop
    const image = await helper.execute({
      type: 'function_call',
      id: 'image',
      call_id: 'image',
      status: 'completed',
      name: 'browser_screenshot',
      arguments: JSON.stringify({ tab_id: null }),
    });
    assert.equal(JSON.parse(image.output[0].text).ok, true);
    const sent = { width: Math.round(viewport.width * scaleX), height: Math.round(viewport.height * scaleY) };
    const picked = {
      x: Math.round((570 * sent.width) / viewport.width),
      y: Math.round((315 * sent.height) / viewport.height),
    };
    const css = {
      x: Math.floor((picked.x * viewport.width) / sent.width),
      y: Math.floor((picked.y * viewport.height) / sent.height),
    };
    // oxlint-disable-next-line no-await-in-loop
    const moved = await inspectCall(
      helper,
      'hover_at',
      { tab_id: null, ...css },
      { signal: controller.signal },
    );
    assert.equal(moved.ok, true);
    // oxlint-disable-next-line no-await-in-loop
    const state = await page.evaluate(() => ({ open: coordinateProof.opened, held: coordinateProof.held }));
    assert.deepEqual(state, { open: true, held: 0 });
    // oxlint-disable-next-line no-await-in-loop
    const fresh = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(fresh.ok, true);
    // oxlint-disable-next-line no-await-in-loop
    const clicked = await inspectCall(helper, 'click_at', {
      tab_id: null,
      ...css,
      button: 'left',
      click_count: 1,
      keys: [],
    });
    assert.equal(clicked.ok, true);
    rows.push({ viewport, sent, picked, css, image: image.output[1].image_url });
  }
  assert.equal(await page.evaluate(() => coordinateProof.clicks), 3);
  const beforeRefusal = await inspectCall(helper, 'screenshot', { tab_id: null });
  assert.equal(beforeRefusal.ok, true);
  approve = false;
  const refusal = await inspectCall(helper, 'hover_at', { tab_id: null, x: 10, y: 10 });
  assert.equal(refusal.ok, false);
  assert.equal(await page.evaluate(() => coordinateProof.opened), true);
  approve = true;
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    inspectCall(helper, 'hover_at', { tab_id: null, x: 10, y: 10 }, { signal: stopped.signal }),
  );
  assert.equal(await page.evaluate(() => coordinateProof.held), 0);
  // An owned test double makes the page's geometry report untrustworthy without changing page globals.
  const view = await page.evaluate(() => [
    innerWidth,
    innerHeight,
    scrollX,
    scrollY,
    devicePixelRatio,
    visualViewport.width,
    visualViewport.height,
    visualViewport.scale,
  ]);
  const { evaluate } = page;
  const { screenshot } = page;
  let captures = 0;
  page.evaluate = async () => view;
  page.screenshot = async (...args) => {
    captures += 1;
    return screenshot.apply(page, args);
  };
  try {
    await record.evaluate((node) => {
      const input = document.createElement('input');
      input.id = 'private-probe';
      node.append(input);
    });
    const privateView = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(privateView.ok, false);
    assert.equal(captures, 0);
    await page.locator('#private-probe').evaluate((node) => node.remove());
    const publicView = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(publicView.ok, true);
    assert.equal(captures, 1);
    await canvas.evaluate((node) => node.replaceWith(node.cloneNode(true)));
    const replacementView = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(replacementView.ok, false);
    assert.equal(captures, 1);
    await record.evaluate((node, original) => node.querySelector('#board').replaceWith(original), canvas);
    await record.evaluate((node) => {
      const host = document.createElement('div');
      host.id = 'shape-probe';
      host.attachShadow({ mode: 'open' }).textContent = 'Fixture text outside the admitted light DOM';
      node.append(host);
    });
    const shadowView = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(shadowView.ok, false);
    assert.equal(captures, 1, 'Never request pixels from an unsupported shadow document');
    await page.locator('#shape-probe').evaluate((node) => node.remove());
    await record.evaluate((node) => {
      const host = document.createElement('fixture-extra');
      host.id = 'shape-probe';
      node.append(host);
    });
    const customView = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(customView.ok, false);
    assert.equal(captures, 1, 'Never request pixels containing an unadmitted custom element');
    await page.locator('#shape-probe').evaluate((node) => node.remove());
    page.evaluate = async () => null;
    const cleanView = await inspectCall(helper, 'screenshot', { tab_id: null });
    assert.equal(cleanView.ok, true);
    assert.equal(captures, 2, 'A clean fixture gets geometry from the trusted scan');
  } finally {
    page.evaluate = evaluate;
    page.screenshot = screenshot;
  }
  const beforeReplace = await inspectCall(helper, 'screenshot', { tab_id: null });
  assert.equal(beforeReplace.ok, true);
  await page.locator('#workspace').evaluate((node) => node.replaceWith(node.cloneNode(true)));
  const replaced = await inspectCall(helper, 'hover_at', { tab_id: null, x: 570, y: 315 });
  assert.equal(replaced.ok, false);
});
if (values.report) {
  const sections = rows
    .map(
      ({ viewport: original, sent, picked, css, image }, i) => `
<section><h2>Case ${i + 1}</h2><p>Original ${original.width} × ${original.height} CSS pixels.
Supplied ${sent.width} × ${sent.height}. Pick (${picked.x}, ${picked.y}) → CSS (${css.x}, ${css.y}).</p>
<div class="pair"><figure><figcaption>Original</figcaption><div class="frame"><img width="${original.width}" height="${original.height}" src="${image}"><span class="mark" style="left:${css.x}px;top:${css.y}px" aria-label="Mapped CSS point"></span></div></figure>
<figure><figcaption>Supplied size</figcaption><div class="frame"><img width="${sent.width}" height="${sent.height}" src="${image}"><span class="mark" style="left:${picked.x}px;top:${picked.y}px" aria-label="Picked image point"></span></div></figure></div></section>`,
    )
    .join('');
  await writeFile(
    values.report,
    `<!doctype html><meta charset="utf-8"><title>Coordinate mapping</title>
<style>body{font:18px system-ui;margin:2rem;background:#f6f4ec;color:#172a1f}.pair{display:flex;gap:2rem;overflow:auto}
figure{margin:0}img{display:block;object-fit:fill}figcaption{margin:1rem 0}.frame{position:relative;outline:1px solid #999}.mark{position:absolute;width:22px;height:22px;box-sizing:border-box;border:3px solid #fff;border-radius:50%;background:#e74726;outline:2px solid #172a1f;transform:translate(-50%,-50%)}</style>
<h1>From image coordinates to browser coordinates</h1>
<p>Move and click used the mapped CSS point in the real local fixture. Each original came from a new checked screenshot.
The second image shows the supplied dimensions for that case. Scroll sideways to compare at their actual sizes.</p>${sections}`,
    { mode: 0o600, flag: 'wx' },
  );
}
console.log(
  JSON.stringify({
    checks: rows.map(({ viewport, sent, picked, css }) => ({ viewport, sent, picked, css })),
    clicks: 3,
    refused: true,
    stopHeld: 0,
    replaced: true,
    trustedViewportAdmission: true,
  }),
);
