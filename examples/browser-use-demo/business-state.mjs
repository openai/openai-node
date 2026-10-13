import { BrowserError } from 'openai/helpers/browser';
import { createHash } from 'node:crypto';
import { digest } from '../responses/browser/file-upload.mjs';
import { waitForDecision } from '../responses/browser/file-state.mjs';

// Host-owned fixture content. tasks.mjs is sent to the browser; these bytes are not.
export const intakeNote = 'SYNTHETIC_PRIVATE_INTAKE_NOTE_501\nReceived at the local fixture dock.\n';

/** A stock shipment label contains public business identifiers, never a private ref. */
export function shipmentLabel(order, sku) {
  return `Ship ${order} with ${sku}`;
}

function refusal() {
  return { status: 403, result: { error: 'No matching business approval.' } };
}

/** Only the exact permitted driver's public scalars may describe a service draft. */
export function readServiceFields(elements) {
  const fields = {};
  for (const name of ['Visit date', 'Technician', 'Service note']) {
    const matches = elements.filter((element) => element.label === name);
    if (matches.length !== 1 || typeof matches[0].value !== 'string') {
      return null;
    }
    fields[name] = matches[0].value;
  }
  return fields;
}

/** One run's business writes. The browser cannot reset or inspect this owner. */
export function createBusinessState(task, run) {
  const balance = new Map((task.stock ?? []).map((item) => [item.sku, item.quantity]));
  const results = [];
  let pending;
  let denied = 0;

  const revoke = (permit) => {
    if (pending === permit) {
      pending = undefined;
      permit.signal.removeEventListener('abort', permit.abort);
      permit.staged.resolve(false);
      permit.reply.resolve(refusal());
    }
  };

  return {
    async bindRead(page, elements) {
      // Match an unambiguous native control to its immutable business record
      // before approval. The owned driver retains/revalidates the actual ref.
      const buttons = await page.locator('button').evaluateAll((nodes) =>
        nodes.map((button) => ({
          // Hidden descendants must not change a visible approval label.
          // oxlint-disable-next-line unicorn/prefer-dom-node-text-content
          label: button.innerText.trim(),
          record: button.closest('[data-record-id]')?.dataset.recordId,
        })),
      );
      const bindings = new Map();
      const service = run.taskId === 'service' ? readServiceFields(elements) : null;
      for (const element of elements) {
        if (element.role !== 'button') {
          continue;
        }
        const matches = buttons.filter((button) => button.label === element.label);
        if (
          service &&
          Object.values(service).every((value) => value.length > 0) &&
          element.label === `Schedule ${task.job}` &&
          matches.length === 1 &&
          matches[0].record === task.job
        ) {
          bindings.set(
            element.ref,
            Object.freeze({
              operation: 'schedule',
              job: task.job,
              date: service['Visit date'],
              technician: service.Technician,
              note: service['Service note'],
            }),
          );
        }
        for (const order of task.orders ?? []) {
          for (const stock of task.stock) {
            if (
              element.label === shipmentLabel(order.id, stock.sku) &&
              matches.length === 1 &&
              matches[0].record === order.id
            ) {
              bindings.set(
                element.ref,
                Object.freeze({ order: order.id, sku: stock.sku, operation: 'ship' }),
              );
            }
          }
        }
      }
      return bindings;
    },
    authorize(operation) {
      if (pending || !operation || run.owner !== 'agent' || run.controller.signal.aborted) {
        throw new BrowserError('Read the current business record before requesting approval.');
      }
      // Node 22.0 can collect an unretained timeout source before any() fires.
      const deadline = AbortSignal.timeout(5000);
      const signal = AbortSignal.any([run.controller.signal, deadline]);
      pending = {
        operation,
        deadline,
        signal,
        staged: Promise.withResolvers(),
        reply: Promise.withResolvers(),
        version: run.ownerVersion,
        received: false,
      };
      const permit = pending;
      permit.abort = () => revoke(permit);
      signal.addEventListener('abort', permit.abort, { once: true });
      return pending;
    },
    receive(body) {
      if (
        !pending ||
        pending.received ||
        run.owner !== 'agent' ||
        run.ownerVersion !== pending.version ||
        run.controller.signal.aborted ||
        !body ||
        Object.getPrototypeOf(body) !== Object.prototype ||
        Object.keys(body).length !== Object.keys(pending.operation).length ||
        Object.entries(pending.operation).some(([key, value]) => body[key] !== value) ||
        (run.taskId === 'stock'
          ? results.some((item) => item.order === body.order) || !(balance.get(body.sku) > 0)
          : results.length !== 0)
      ) {
        denied += 1;
        return refusal();
      }
      pending.received = true;
      pending.staged.resolve(true);
      return pending.reply.promise;
    },
    async receiveFile(request) {
      const permit = pending;
      if (
        !permit ||
        permit.received ||
        run.owner !== 'agent' ||
        run.ownerVersion !== permit.version ||
        permit.signal.aborted ||
        request.headers['content-type'] !== 'application/octet-stream' ||
        ![undefined, 'identity'].includes(request.headers['content-encoding']) ||
        (request.headers['content-length'] &&
          Number(request.headers['content-length']) !== permit.operation.count)
      ) {
        denied += 1;
        return refusal();
      }
      // Reserve this existing one-use permit before any receive awaits. No
      // second upload can race a slow first body into the same approved slot.
      permit.received = true;
      const hash = createHash('sha256');
      let count = 0;
      const stopReading = () => request.destroy();
      permit.signal.addEventListener('abort', stopReading, { once: true });
      try {
        for await (const chunk of request) {
          count += chunk.length;
          // The private upload owner's approved count is already at most 64 KiB.
          if (count > permit.operation.count || permit.signal.aborted) {
            throw new Error('Fixture file refused.');
          }
          hash.update(chunk);
        }
        if (
          pending !== permit ||
          permit.signal.aborted ||
          run.owner !== 'agent' ||
          run.ownerVersion !== permit.version ||
          count !== permit.operation.count ||
          hash.digest('hex') !== permit.operation.sha256
        ) {
          throw new Error('Fixture file refused.');
        }
      } catch {
        denied += 1;
        revoke(permit);
        return refusal();
      } finally {
        permit.signal.removeEventListener('abort', stopReading);
      }
      permit.staged.resolve(true);
      return permit.reply.promise;
    },
    async finish(permit, page) {
      const phaseSignal = run.controller.signal;
      // Only the runner calls finish, after the native ref check and action
      // return. A matching browser request cannot commit by itself.
      if (
        !(await permit.staged.promise) ||
        pending !== permit ||
        permit.signal.aborted ||
        run.owner !== 'agent' ||
        run.ownerVersion !== permit.version
      ) {
        throw new Error('The checked business action was not completed.');
      }
      if (run.taskId === 'stock') {
        const { sku } = permit.operation;
        balance.set(sku, balance.get(sku) - 1);
      }
      results.push({ ...permit.operation });
      const revision = results.length;
      permit.reply.resolve({ status: 200, result: { revision } });
      await waitForDecision(
        () =>
          page.waitForFunction((value) => Number(document.body.dataset.revision) === value, revision, {
            timeout: 5000,
          }),
        phaseSignal,
      );
    },
    revoke,
    snapshot() {
      const finished = results.length === (task.orders?.length ?? 1);
      let verified = false;
      if (finished) {
        if (run.taskId === 'stock') {
          verified = task.orders.every((order) =>
            results.some(
              (item) =>
                item.order === order.id &&
                task.stock.some((stock) => stock.sku === item.sku && stock.colour === order.colour),
            ),
          );
        } else if (run.taskId === 'files') {
          verified =
            results[0].job === task.job &&
            results[0].count === Buffer.byteLength(intakeNote) &&
            results[0].sha256 === digest(Buffer.from(intakeNote));
        } else {
          verified =
            results[0].job === task.job &&
            results[0].date === task.fields['Visit date'] &&
            results[0].technician === task.fields.Technician &&
            results[0].note === task.fields['Service note'];
        }
      }
      return {
        revision: results.length,
        finished,
        verified,
        results: results.map((item) =>
          run.taskId === 'files' ? { operation: item.operation, job: item.job } : { ...item },
        ),
        ...(run.taskId === 'files' ? { file: run.session?.fileState() ?? null } : {}),
        ...(run.taskId === 'stock'
          ? { stock: [...balance].map(([sku, quantity]) => ({ sku, quantity })) }
          : {}),
        denied,
      };
    },
  };
}
