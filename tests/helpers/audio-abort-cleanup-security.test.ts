import { vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { recordAudio } from 'openai/helpers/audio';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn() };
});

const spawnMock = vi.mocked(childProcess.spawn);

function createRecordingProcess() {
  const process = new childProcess.ChildProcess();
  const stdout = new PassThrough();
  Object.defineProperty(process, 'stdout', { configurable: true, value: stdout });
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  spawnMock.mockReturnValue(process);
  return { process, stdout, kill };
}

function createSignals() {
  const caller = new AbortController();
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  return { caller, timeout };
}

function createFailureWithCause(message: string, cause: Error) {
  const failure = new Error(message);
  Object.defineProperty(failure, 'cause', { configurable: true, value: cause, writable: true });
  return failure;
}

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('recordAudio callback and cancellation cleanup security', () => {
  test.each(['caller', 'timeout', 'stdout'] as const)(
    'preserves captured WAV when %s cleanup throws before removing its listener',
    async (target) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const recording = recordAudio({ signal: caller.signal, timeout: 25 });
      const removeCaller = vi.spyOn(caller.signal, 'removeEventListener');
      const removeTimeout = vi.spyOn(timeout.signal, 'removeEventListener');
      const removeStdout = vi.spyOn(stdout, 'removeListener');

      if (target === 'caller') {
        removeCaller.mockImplementation(() => {
          throw new Error('caller cleanup rejected');
        });
      } else if (target === 'timeout') {
        removeTimeout.mockImplementation(() => {
          throw new Error('timeout cleanup rejected');
        });
      } else {
        removeStdout.mockImplementation(() => {
          throw new Error('stdout cleanup rejected');
        });
      }

      stdout.write(Buffer.from('captured audio'));
      expect(() => process.emit('close', 0)).not.toThrow();

      const file = await recording;
      expect(file.name).toBe('audio.wav');
      expect(file.type).toBe('audio/wav');
      expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured audio');
      expect(removeCaller).toHaveBeenCalled();
      expect(removeTimeout).toHaveBeenCalled();
      expect(removeStdout).toHaveBeenCalled();

      caller.abort();
      timeout.abort();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  test.each(['caller', 'timeout', 'stdout'] as const)(
    'preserves captured WAV when %s cleanup throws after removing its listener',
    async (target) => {
      const { process, stdout } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const recording = recordAudio({ signal: caller.signal, timeout: 25 });

      if (target === 'caller') {
        const original = caller.signal.removeEventListener.bind(caller.signal);
        vi.spyOn(caller.signal, 'removeEventListener').mockImplementation((...args) => {
          original(...args);
          throw new Error('caller cleanup failed after removal');
        });
      } else if (target === 'timeout') {
        const original = timeout.signal.removeEventListener.bind(timeout.signal);
        vi.spyOn(timeout.signal, 'removeEventListener').mockImplementation((...args) => {
          original(...args);
          throw new Error('timeout cleanup failed after removal');
        });
      } else {
        const original = stdout.removeListener.bind(stdout);
        vi.spyOn(stdout, 'removeListener').mockImplementation((...args) => {
          original(...args);
          throw new Error('stdout cleanup failed after removal');
        });
      }

      stdout.write(Buffer.from('captured'));
      expect(() => process.emit('close', 0)).not.toThrow();
      const file = await recording;
      expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured');
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);
    },
  );

  test('attempts every throwing cleanup while preserving the original process error and unrelated listeners', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    const unrelatedCaller = vi.fn();
    const unrelatedTimeout = vi.fn();
    const unrelatedOutput = vi.fn();
    caller.signal.addEventListener('abort', unrelatedCaller);
    timeout.signal.addEventListener('abort', unrelatedTimeout);
    stdout.on('data', unrelatedOutput);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('original device failure');
    const failure = createFailureWithCause('microphone unavailable', cause);
    const recording = recordAudio({ signal: caller.signal, timeout: 25 });

    const removeCaller = vi.spyOn(caller.signal, 'removeEventListener').mockImplementation(() => {
      throw new Error('caller cleanup failure');
    });
    const removeTimeout = vi.spyOn(timeout.signal, 'removeEventListener').mockImplementation(() => {
      throw new Error('timeout cleanup failure');
    });
    const removeStdout = vi.spyOn(stdout, 'removeListener').mockImplementation(() => {
      throw new Error('stdout cleanup failure');
    });

    expect(() => process.emit('error', failure)).not.toThrow();
    await expect(recording).rejects.toBe(failure);
    expect(Object.getOwnPropertyDescriptor(failure, 'cause')?.value).toBe(cause);
    expect(removeCaller).toHaveBeenCalledTimes(1);
    expect(removeTimeout).toHaveBeenCalledTimes(1);
    expect(removeStdout).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(failure);

    caller.abort();
    timeout.abort();
    stdout.write(Buffer.from('unrelated output'));
    expect(unrelatedCaller).toHaveBeenCalledTimes(1);
    expect(unrelatedTimeout).toHaveBeenCalledTimes(1);
    expect(unrelatedOutput).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  test('rejects an unexpected unsuccessful exit when all cleanup callbacks throw', async () => {
    const { process, stdout } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    const recording = recordAudio({ signal: caller.signal, timeout: 25 });

    const removeCaller = vi.spyOn(caller.signal, 'removeEventListener').mockImplementation(() => {
      throw new Error('caller removal failed');
    });
    const removeTimeout = vi.spyOn(timeout.signal, 'removeEventListener').mockImplementation(() => {
      throw new Error('timeout removal failed');
    });
    const removeStdout = vi.spyOn(stdout, 'removeListener').mockImplementation(() => {
      throw new Error('stdout removal failed');
    });

    expect(() => process.emit('close', 12)).not.toThrow();
    await expect(recording).rejects.toThrow('ffmpeg process exited with code 12');
    expect(removeCaller).toHaveBeenCalledTimes(1);
    expect(removeTimeout).toHaveBeenCalledTimes(1);
    expect(removeStdout).toHaveBeenCalledTimes(1);
  });

  test('never captures private stdout emitted during throwing removal or after settlement', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const caller = new AbortController();
    const unrelatedOutput = vi.fn();
    stdout.on('data', unrelatedOutput);
    const recording = recordAudio({ signal: caller.signal });

    stdout.write(Buffer.from('captured public audio'));
    vi.spyOn(stdout, 'removeListener').mockImplementation(() => {
      stdout.write(Buffer.from('private cleanup audio'));
      throw new Error('stdout listener could not be detached');
    });
    const concatenate = vi.spyOn(Buffer, 'concat');

    expect(() => process.emit('close', 0)).not.toThrow();
    const capturedChunks = concatenate.mock.calls[0]?.[0];
    expect(capturedChunks).toHaveLength(1);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured public audio');

    stdout.write(Buffer.from('private late audio'));
    expect(capturedChunks).toHaveLength(1);
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured public audio');
    expect(unrelatedOutput).toHaveBeenCalledTimes(3);

    caller.abort();
    expect(kill).not.toHaveBeenCalled();
  });

  test.each(['caller', 'timeout'] as const)(
    'suppresses private %s-cleanup errors and aborts after reserving a successful recording',
    async (target) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
      const recording = recordAudio({ signal: caller.signal, timeout: 25 });
      stdout.write(Buffer.from('captured audio'));
      const owner = target === 'caller' ? caller : timeout;
      const original = owner.signal.removeEventListener.bind(owner.signal);

      vi.spyOn(owner.signal, 'removeEventListener').mockImplementation((...args) => {
        original(...args);
        process.emit('error', new Error('private late subprocess error'));
        caller.abort();
        timeout.abort();
      });

      expect(() => process.emit('close', 0)).not.toThrow();
      const file = await recording;
      expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured audio');
      expect(logger).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  test('keeps the process error listener without logging private errors after success', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const caller = new AbortController();
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recording = recordAudio({ signal: caller.signal });
    stdout.write(Buffer.from('captured'));

    process.emit('close', 0);
    await recording;

    expect(() => process.emit('error', new Error('private late device failure'))).not.toThrow();
    expect(logger).not.toHaveBeenCalled();
    caller.abort();
    expect(kill).not.toHaveBeenCalled();
  });

  test('preserves the original process failure when its configured logger throws', async () => {
    const { process, stdout } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    const loggerFailure = new Error('logging destination unavailable');
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {
      throw loggerFailure;
    });
    const cause = new Error('underlying device failure');
    const failure = createFailureWithCause('microphone unavailable', cause);
    const recording = recordAudio({ signal: caller.signal, timeout: 25 });

    expect(() => process.emit('error', failure)).not.toThrow();
    await expect(recording).rejects.toBe(failure);
    expect(Object.getOwnPropertyDescriptor(failure, 'cause')?.value).toBe(cause);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(failure);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
    expect(stdout.listenerCount('data')).toBe(0);
  });

  test('reserves the first process error before a reentrant logger emits competing outcomes', async () => {
    const { process } = createRecordingProcess();
    const first = new Error('original microphone failure');
    const privateFailure = new Error('private secondary microphone failure');
    let reentered = false;
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {
      if (!reentered) {
        reentered = true;
        process.emit('close', 0);
        process.emit('error', privateFailure);
      }
    });
    const recording = recordAudio();

    expect(() => process.emit('error', first)).not.toThrow();
    await expect(recording).rejects.toBe(first);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(first);
  });

  test('does not register abort listeners after a genuine newListener hook settles setup', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    const first = new Error('microphone failed while close observation was installed');
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    let emitted = false;

    process.on('newListener', (event) => {
      if (event === 'close' && !emitted) {
        emitted = true;
        process.emit('error', first);
      }
    });

    await expect(recordAudio({ signal: caller.signal, timeout: 25 })).rejects.toBe(first);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(first);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
    expect(stdout.listenerCount('data')).toBe(0);

    caller.abort();
    timeout.abort();
    expect(kill).not.toHaveBeenCalled();
  });

  test.each(['caller', 'timeout'] as const)(
    'removes a %s abort listener installed after its registration synchronously settles',
    async (target) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const first = new Error('microphone failed while abort handling was installed');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const owner = target === 'caller' ? caller : timeout;
      const original = owner.signal.addEventListener.bind(owner.signal);

      vi.spyOn(owner.signal, 'addEventListener').mockImplementation((...args) => {
        process.emit('error', first);
        original(...args);
      });

      await expect(recordAudio({ signal: caller.signal, timeout: 25 })).rejects.toBe(first);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);

      caller.abort();
      timeout.abort();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  test.each(['before attaching', 'after attaching'] as const)(
    'preserves a %s registration failure when native-style termination emits a secondary error',
    async (timing) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const unrelated = vi.fn();
      caller.signal.addEventListener('abort', unrelated);
      const cause = new Error('registration root cause');
      const first = createFailureWithCause('caller abort registration failed', cause);
      const secondary = new Error('private EPERM termination failure');
      const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
      const original = caller.signal.addEventListener.bind(caller.signal);

      vi.spyOn(caller.signal, 'addEventListener').mockImplementation((...args) => {
        if (timing === 'after attaching') {
          original(...args);
        }
        throw first;
      });
      kill.mockImplementation(() => {
        process.emit('error', secondary);
        return false;
      });

      await expect(recordAudio({ signal: caller.signal, timeout: 25 })).rejects.toBe(first);
      expect(Object.getOwnPropertyDescriptor(first, 'cause')?.value).toBe(cause);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith('SIGTERM');
      expect(logger).not.toHaveBeenCalled();
      expect(getEventListeners(caller.signal, 'abort')).toEqual([unrelated]);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);

      caller.abort();
      expect(unrelated).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledTimes(1);
    },
  );

  test('preserves a registration failure when native-style process termination throws', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    const cause = new Error('registration root cause');
    const first = createFailureWithCause('caller abort registration failed', cause);
    const terminationFailure = new Error('EINVAL termination failure');
    vi.spyOn(caller.signal, 'addEventListener').mockImplementation(() => {
      throw first;
    });
    kill.mockImplementation(() => {
      throw terminationFailure;
    });

    await expect(recordAudio({ signal: caller.signal, timeout: 25 })).rejects.toBe(first);
    expect(Object.getOwnPropertyDescriptor(first, 'cause')?.value).toBe(cause);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
    expect(stdout.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(1);
  });

  test.each(['caller', 'timeout'] as const)(
    'rejects the exact native-style synchronous termination error from %s cancellation',
    async (target) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const failure = new Error('EPERM signal delivery failed');
      const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
      const recording = recordAudio({ signal: caller.signal, timeout: 25 });
      kill.mockImplementation(() => {
        process.emit('error', failure);
        return false;
      });

      expect(() => (target === 'caller' ? caller : timeout).abort()).not.toThrow();
      await expect(recording).rejects.toBe(failure);
      expect(logger).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledWith(failure);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);
    },
  );

  test.each(['caller', 'timeout'] as const)(
    'rejects the exact thrown native-style termination failure from %s cancellation',
    async (target) => {
      const { stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const failure = new Error('EINVAL signal delivery failed');
      const recording = recordAudio({ signal: caller.signal, timeout: 25 });
      kill.mockImplementation(() => {
        throw failure;
      });

      expect(() => (target === 'caller' ? caller : timeout).abort()).not.toThrow();
      await expect(recording).rejects.toBe(failure);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);
    },
  );

  test('retains the existing unsuccessful-exit behavior when cancellation cannot signal its process', async () => {
    const { process, kill } = createRecordingProcess();
    const caller = new AbortController();
    kill.mockReturnValue(false);
    const recording = recordAudio({ signal: caller.signal });

    caller.abort();
    process.emit('close', 19);

    await expect(recording).rejects.toThrow('ffmpeg process exited with code 19');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('preserves successful intentional cancellation and the original captured audio', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const caller = new AbortController();
    const recording = recordAudio({ signal: caller.signal });
    stdout.write(Buffer.from('captured before stop'));

    caller.abort();
    process.emit('close', 255);

    const file = await recording;
    expect(file.name).toBe('audio.wav');
    expect(file.type).toBe('audio/wav');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured before stop');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('stops when a structural caller aborts before its listener is actually installed', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const caller = new AbortController();
    const original = caller.signal.addEventListener.bind(caller.signal);
    vi.spyOn(caller.signal, 'addEventListener').mockImplementation((...args) => {
      caller.abort(new Error('recording was cancelled during listener registration'));
      original(...args);
    });

    const recording = recordAudio({ signal: caller.signal });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    stdout.write(Buffer.from('captured after immediate stop'));
    process.emit('close', 255);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured after immediate stop');
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
  });

  test('does not retry a failed termination for a caller abort already observed during registration', async () => {
    const { process, kill } = createRecordingProcess();
    const caller = new AbortController();
    const original = caller.signal.addEventListener.bind(caller.signal);
    kill.mockReturnValue(false);
    vi.spyOn(caller.signal, 'addEventListener').mockImplementation((...args) => {
      original(...args);
      caller.abort();
    });

    const recording = recordAudio({ signal: caller.signal });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    process.emit('close', 23);

    await expect(recording).rejects.toThrow('ffmpeg process exited with code 23');
  });

  test('preserves a pre-aborted caller termination error without attempting to terminate twice', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    caller.abort();
    const cause = new Error('underlying termination failure');
    const first = createFailureWithCause('EINVAL first signal delivery failed', cause);
    const second = new Error('a second termination must not be attempted');
    kill.mockImplementationOnce(() => {
      throw first;
    });
    kill.mockImplementationOnce(() => {
      throw second;
    });

    await expect(recordAudio({ signal: caller.signal, timeout: 25 })).rejects.toBe(first);
    expect(Object.getOwnPropertyDescriptor(first, 'cause')?.value).toBe(cause);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
    expect(stdout.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(1);
  });

  test.each(['caller', 'timeout'] as const)(
    'never terminates twice when %s registration aborts successfully and then fails',
    async (target) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const cause = new Error('registration root cause');
      const first = createFailureWithCause('abort listener installation failed', cause);
      const owner = target === 'caller' ? caller : timeout;
      const original = owner.signal.addEventListener.bind(owner.signal);

      vi.spyOn(owner.signal, 'addEventListener').mockImplementation((...args) => {
        original(...args);
        owner.abort();
        throw first;
      });

      await expect(recordAudio({ signal: caller.signal, timeout: 25 })).rejects.toBe(first);
      expect(Object.getOwnPropertyDescriptor(first, 'cause')?.value).toBe(cause);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledWith('SIGTERM');
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);
      expect(process.listenerCount('error')).toBe(1);
    },
  );

  test('observes caller cancellation when a simultaneous timeout cannot terminate the process', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    kill.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const original = caller.signal.addEventListener.bind(caller.signal);

    vi.spyOn(caller.signal, 'addEventListener').mockImplementation((...args) => {
      timeout.abort();
      caller.abort();
      original(...args);
    });

    const recording = recordAudio({ signal: caller.signal, timeout: 25 });
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGTERM');
    stdout.write(Buffer.from('captured despite simultaneous cancellation'));
    process.emit('close', 255);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe(
      'captured despite simultaneous cancellation',
    );
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
  });

  test('stops when a structural timeout aborts before its listener is actually installed', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const original = timeout.signal.addEventListener.bind(timeout.signal);
    vi.spyOn(timeout.signal, 'addEventListener').mockImplementation((...args) => {
      timeout.abort(new Error('recording timed out during listener registration'));
      original(...args);
    });

    const recording = recordAudio({ timeout: 25 });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    stdout.write(Buffer.from('captured after immediate timeout'));
    process.emit('close', 255);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured after immediate timeout');
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
  });

  test('does not retry a failed termination for a timeout abort already observed during registration', async () => {
    const { process, kill } = createRecordingProcess();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const original = timeout.signal.addEventListener.bind(timeout.signal);
    kill.mockReturnValue(false);
    vi.spyOn(timeout.signal, 'addEventListener').mockImplementation((...args) => {
      original(...args);
      timeout.abort();
    });

    const recording = recordAudio({ timeout: 25 });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    process.emit('close', 24);

    await expect(recording).rejects.toThrow('ffmpeg process exited with code 24');
  });

  test('retries caller cancellation after a missed timeout cannot terminate the process', async () => {
    const { process, stdout, kill } = createRecordingProcess();
    const { caller, timeout } = createSignals();
    kill.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const original = timeout.signal.addEventListener.bind(timeout.signal);
    vi.spyOn(timeout.signal, 'addEventListener').mockImplementation((...args) => {
      timeout.abort();
      original(...args);
    });

    const recording = recordAudio({ signal: caller.signal, timeout: 25 });
    expect(kill).toHaveBeenCalledTimes(1);
    caller.abort();
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGTERM');
    stdout.write(Buffer.from('captured after caller retry'));
    process.emit('close', 255);

    const file = await recording;
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('captured after caller retry');
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
  });

  test.each(['emits', 'throws'] as const)(
    'never installs a caller listener after missed-timeout termination %s a native failure',
    async (behavior) => {
      const { process, stdout, kill } = createRecordingProcess();
      const { caller, timeout } = createSignals();
      const cause = new Error('underlying signal-delivery failure');
      const failure = createFailureWithCause('missed timeout could not terminate ffmpeg', cause);
      const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
      const original = timeout.signal.addEventListener.bind(timeout.signal);
      vi.spyOn(timeout.signal, 'addEventListener').mockImplementation((...args) => {
        timeout.abort();
        original(...args);
      });
      kill.mockImplementation(() => {
        if (behavior === 'emits') {
          process.emit('error', failure);
          return false;
        }
        throw failure;
      });

      const recording = recordAudio({ signal: caller.signal, timeout: 25 });
      expect(kill).toHaveBeenCalledTimes(1);
      await expect(recording).rejects.toBe(failure);
      expect(Object.getOwnPropertyDescriptor(failure, 'cause')?.value).toBe(cause);
      expect(logger).toHaveBeenCalledTimes(behavior === 'emits' ? 1 : 0);
      if (behavior === 'emits') {
        expect(logger).toHaveBeenCalledWith(failure);
      }
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(timeout.signal, 'abort')).toHaveLength(0);
      expect(stdout.listenerCount('data')).toBe(0);

      caller.abort();
      expect(kill).toHaveBeenCalledTimes(1);
    },
  );
});
