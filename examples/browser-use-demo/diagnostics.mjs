import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdtempSync,
  lstatSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const maxBytes = 1024 * 1024;
const maxRuns = 16;

/** Numeric public summary and a separate, explicitly enabled private recorder. */
export class RunDiagnostics {
  constructor(capture, mode) {
    this.recorder = capture?.start() ?? null;
    this.enabled = Boolean(capture);
    this.live = mode === 'live';
    this.recordedRequests = 0;
    this.tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    this.times = { apiMs: null, actionMs: null, approvalMs: null };
  }

  record(kind, data) {
    this.recorder?.record(kind, data);
  }

  frame(metadata, pixels) {
    this.recorder?.frame(metadata, pixels);
  }

  event(event) {
    this.record('runner', event);
    if (event.stage !== 'request' || event.reason === 'started' || !this.live) {
      return;
    }
    this.measure('apiMs', event.duration_ms);
    const { usage } = event;
    if (
      usage &&
      ['input_tokens', 'output_tokens', 'total_tokens'].every(
        (key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0,
      )
    ) {
      this.recordedRequests += 1;
      this.tokens.inputTokens += usage.input_tokens;
      this.tokens.outputTokens += usage.output_tokens;
      this.tokens.totalTokens += usage.total_tokens;
    }
  }

  measure(stage, duration) {
    if (Object.hasOwn(this.times, stage) && Number.isFinite(duration) && duration >= 0) {
      this.times[stage] = (this.times[stage] ?? 0) + duration;
    }
  }

  summary(requests) {
    return {
      usage: {
        recordedRequests: this.recordedRequests,
        missingRequests: Math.max(0, requests - this.recordedRequests),
        complete: requests > 0 && requests === this.recordedRequests,
        inputTokens: this.recordedRequests ? this.tokens.inputTokens : null,
        outputTokens: this.recordedRequests ? this.tokens.outputTokens : null,
        totalTokens: this.recordedRequests ? this.tokens.totalTokens : null,
      },
      timing: Object.fromEntries(
        Object.entries(this.times).map(([key, value]) => [key, value === null ? null : Math.round(value)]),
      ),
      capture: {
        enabled: this.enabled,
        status: this.recorder?.status ?? (this.enabled ? 'limited' : 'disabled'),
        omitted: this.recorder?.omitted ?? 0,
      },
    };
  }

  close() {
    this.recorder?.close();
  }
}

function validDiagnosticData(kind, data) {
  if (kind === 'observation') {
    return (
      typeof data === 'string' || (Array.isArray(data) && data.every((part) => typeof part === 'string'))
    );
  }
  if (kind === 'choices') {
    return (
      Array.isArray(data) &&
      data.every(
        (choice) =>
          choice !== null &&
          typeof choice === 'object' &&
          typeof choice.id === 'string' &&
          typeof choice.description === 'string' &&
          typeof choice.done === 'boolean',
      )
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const fields = (...names) => names.every((name) => Object.hasOwn(data, name));
  const strings = (...names) => fields(...names) && names.every((name) => typeof data[name] === 'string');
  const counts = (...names) =>
    fields(...names) && names.every((name) => Number.isInteger(data[name]) && data[name] >= 0);
  const valid = {
    run: () =>
      strings('api', 'mode', 'taskId') ||
      (strings('status', 'cleanup') &&
        fields('result') &&
        (data.result === null || typeof data.result === 'string')),
    runner: () => strings('api', 'stage', 'reason'),
    effect: () =>
      strings('member') &&
      fields('state') &&
      data.state !== null &&
      typeof data.state === 'object' &&
      !Array.isArray(data.state),
    verification: () => fields('verified') && typeof data.verified === 'boolean',
    frame: () =>
      strings('owner', 'role', 'mime') &&
      counts('sequence') &&
      data.sequence > 0 &&
      ['image/jpeg', 'image/png'].includes(data.mime),
    capture: () => strings('status') && counts('omitted', 'frames', 'omittedFrames'),
  };
  return Object.hasOwn(valid, kind) && valid[kind]();
}

function parseDiagnosticTrace(text) {
  const records = [];
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (
        record.version !== 1 ||
        !Number.isFinite(record.atMs) ||
        record.atMs < 0 ||
        !Object.hasOwn(record, 'data') ||
        !validDiagnosticData(record.kind, record.data)
      ) {
        throw new Error('Invalid trace record.');
      }
      records.push(record);
    } catch {
      return { records, incomplete: true };
    }
  }
  return { records, incomplete: records.at(-1)?.kind !== 'capture' };
}

function ownedFile(filename, limit) {
  // oxlint-disable-next-line no-bitwise
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    // oxlint-disable-next-line no-bitwise
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      // oxlint-disable-next-line no-bitwise
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > limit
    ) {
      throw new Error('Capture file unavailable.');
    }
    const data = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < data.length) {
      const size = readSync(descriptor, data, offset, data.length - offset, null);
      if (!size) {
        break;
      }
      offset += size;
    }
    if (offset > limit) {
      throw new Error('Capture file exceeded its limit.');
    }
    return data.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
}

/** Explicit local capture. Only the authenticated, read-only trace viewer may open it. */
export function createDiagnosticCapture({ secrets = [], captureId } = {}) {
  if (process.platform === 'win32') {
    throw new Error('Private diagnostic capture requires a filesystem with POSIX owner-only permissions.');
  }
  const prefix = 'openai-browser-diagnostics-';
  if (captureId !== undefined && !/^openai-browser-diagnostics-[A-Za-z0-9_-]{6,12}$/u.test(captureId)) {
    throw new Error('Choose the capture ID printed by this demo, not a path or URL.');
  }
  const directory =
    captureId === undefined ? mkdtempSync(path.join(tmpdir(), prefix)) : path.join(tmpdir(), captureId);
  if (captureId === undefined) {
    chmodSync(directory, 0o700);
  }
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.uid !== process.getuid() ||
    // oxlint-disable-next-line no-bitwise
    (directoryStat.mode & 0o777) !== 0o700
  ) {
    throw new Error('The capture must be an owner-only directory created by this demo.');
  }
  const existing = new Set(readdirSync(directory));
  const names = Array.from({ length: maxRuns }, (_, index) => `run-${index + 1}`);
  function traceData(id) {
    if (!names.includes(id)) {
      throw new Error('Saved trace unavailable.');
    }
    return parseDiagnosticTrace(ownedFile(path.join(directory, `${id}.jsonl`), maxBytes).toString('utf-8'));
  }
  const privateValues = secrets.filter((value) => typeof value === 'string' && value.length > 0);
  const redact = (_key, value) => {
    if (typeof value !== 'string') {
      return value;
    }
    let redacted = value;
    for (const secret of privateValues) {
      redacted = redacted.replaceAll(secret, '[redacted]');
    }
    return redacted.replaceAll(/sk-[\w-]+/gu, '[redacted]');
  };
  let runs = 0;
  for (const [index, name] of names.entries()) {
    if (existing.has(`${name}.jsonl`)) {
      runs = index + 1;
    }
  }
  return {
    directory,
    id: path.basename(directory),
    traces() {
      return names.filter((name) => {
        try {
          traceData(name);
          return true;
        } catch {
          return false;
        }
      });
    },
    trace: traceData,
    frame(id, sequence) {
      if (!/^[1-9][0-9]{0,8}$/u.test(sequence)) {
        throw new Error('Saved frame unavailable.');
      }
      const record = traceData(id).records.find(
        (entry) => entry.kind === 'frame' && String(entry.data.sequence) === sequence,
      );
      if (!record || !['image/jpeg', 'image/png'].includes(record.data.mime)) {
        throw new Error('Saved frame unavailable.');
      }
      return {
        pixels: ownedFile(path.join(directory, `${id}-${sequence}.frame`), maxBytes),
        mime: record.data.mime,
      };
    },
    start() {
      if (runs >= maxRuns) {
        return null;
      }
      runs += 1;
      const id = `run-${runs}`;
      const filename = path.join(directory, `${id}.jsonl`);
      let descriptor;
      let bytes = 0;
      let omitted = 0;
      let omittedFrames = 0;
      let frameBytes = 0;
      let frames = 0;
      let status = 'recording';
      const started = performance.now();
      try {
        descriptor = openSync(filename, 'wx', 0o600);
        fchmodSync(descriptor, 0o600);
      } catch {
        if (descriptor !== undefined) {
          try {
            closeSync(descriptor);
          } catch {
            // Capture failure cannot change the action result.
          }
        }
        descriptor = undefined;
        status = 'failed';
      }
      return {
        filename,
        get status() {
          return status;
        },
        get omitted() {
          return omitted;
        },
        frame(metadata, pixels) {
          if (descriptor === undefined || !['image/jpeg', 'image/png'].includes(metadata.mime)) {
            return;
          }
          if (frames >= 12 || pixels.length > maxBytes || frameBytes + pixels.length > 8 * maxBytes) {
            omittedFrames += 1;
            return;
          }
          try {
            const frameName = path.join(directory, `${id}-${metadata.sequence}.frame`);
            writeFileSync(frameName, pixels, { flag: 'wx', mode: 0o600 });
            if (this.record('frame', metadata)) {
              frames += 1;
              frameBytes += pixels.length;
            } else {
              unlinkSync(frameName);
              omittedFrames += 1;
            }
          } catch {
            omittedFrames += 1;
          }
        },
        record(kind, data) {
          if (descriptor === undefined) {
            return false;
          }
          try {
            const serialized = JSON.stringify(
              { version: 1, kind, atMs: Math.round(performance.now() - started), data },
              redact,
            );
            const line = Buffer.from(`${serialized}\n`);
            if (bytes + line.length > (kind === 'capture' ? maxBytes : maxBytes - 512)) {
              omitted += 1;
              status = 'limited';
              return false;
            }
            // A short filesystem write must not leave the next JSON record inside this one.
            let offset = 0;
            while (offset < line.length) {
              const written = writeSync(descriptor, line, offset);
              if (written === 0) {
                throw new Error('Diagnostic write did not advance.');
              }
              offset += written;
            }
            bytes += line.length;
            return true;
          } catch {
            status = 'failed';
            try {
              closeSync(descriptor);
            } catch {
              // Capture failure cannot change the action result.
            }
            descriptor = undefined;
            return false;
          }
        },
        close() {
          if (descriptor !== undefined && status !== 'failed') {
            this.record('capture', {
              status: status === 'recording' ? 'complete' : status,
              omitted,
              frames,
              omittedFrames,
            });
          }
          if (descriptor !== undefined) {
            try {
              closeSync(descriptor);
              if (status === 'recording') {
                status = 'complete';
              }
            } catch {
              status = 'failed';
            }
            descriptor = undefined;
          }
        },
      };
    },
  };
}

/** Capture only text observations; image bytes and transport credentials never enter this path. */
export function diagnosticObservation(observation) {
  return typeof observation === 'string'
    ? observation
    : observation.filter((part) => part.type === 'input_text').map((part) => part.text);
}

/** Read data only. A trace is evidence, never a program or a source of replayable actions. */
export function readDiagnosticTrace(filename) {
  // Nonblocking open lets the regular-file check reject pipes without waiting for a writer.
  // oxlint-disable-next-line no-bitwise
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  let text;
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error('Choose a diagnostic JSONL file no larger than 1 MiB.');
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const size = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (size === 0) {
        break;
      }
      offset += size;
    }
    if (offset > maxBytes) {
      throw new Error('Diagnostic file grew beyond 1 MiB.');
    }
    text = buffer.subarray(0, offset).toString('utf-8');
  } finally {
    closeSync(descriptor);
  }
  return parseDiagnosticTrace(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    throw new Error('Usage: node diagnostics.mjs /path/to/run-1.jsonl');
  }
  const trace = readDiagnosticTrace(process.argv[2]);
  console.error(
    'Private local evidence: inspect page values before sharing. This command never executes actions.',
  );
  console.log(JSON.stringify(trace, null, 2));
  if (trace.incomplete) {
    process.exitCode = 2;
  }
}
