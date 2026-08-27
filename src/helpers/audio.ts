import { spawn } from 'node:child_process';
import { pipeline, Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { platform, versions } from 'node:process';
import { checkFileSupport } from '../internal/uploads';

const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHANNELS = 1;

const isNode = Boolean(versions?.node);

const recordingProviders: Record<NodeJS.Platform, string> = {
  win32: 'dshow',
  darwin: 'avfoundation',
  linux: 'alsa',
  aix: 'alsa',
  android: 'alsa',
  freebsd: 'alsa',
  haiku: 'alsa',
  sunos: 'alsa',
  netbsd: 'alsa',
  openbsd: 'alsa',
  cygwin: 'dshow',
};

function isResponse(stream: NodeJS.ReadableStream | Response | File): stream is Response {
  return (stream as any).body !== undefined;
}

function isFile(stream: NodeJS.ReadableStream | Response | File): stream is File {
  checkFileSupport();
  return stream instanceof File;
}

async function nodejsPlayAudio(stream: NodeJS.ReadableStream | Response | File): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      let source: NodeJS.ReadableStream;
      if (isResponse(stream)) {
        const body = stream.body as NodeReadableStream | NodeJS.ReadableStream | null;
        if (!body) {
          throw new Error('Cannot play audio from a response without a body');
        }

        source =
          'pipe' in body && typeof body.pipe === 'function'
            ? body
            : Readable.fromWeb(body as NodeReadableStream);
      } else if (isFile(stream)) {
        source = Readable.from(stream.stream());
      } else {
        source = stream;
      }

      const ffplay = spawn('ffplay', ['-autoexit', '-nodisp', '-i', 'pipe:0']);
      ffplay.stdout?.resume();
      ffplay.stderr?.resume();
      ffplay.on('error', reject);

      pipeline(source, ffplay.stdin, (error) => {
        if (error) {
          ffplay.kill();
          reject(error);
        }
      });

      ffplay.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`ffplay process exited with code ${code}`));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Plays audio from a Node.js readable stream, fetch response, or `File`.
 *
 * This helper is supported only in Node.js-compatible runtimes and requires
 * the `ffplay` executable from FFmpeg to be available on `PATH`. Audio is
 * streamed to `ffplay` without first buffering the complete input.
 *
 * @param input Audio data in a format recognized by `ffplay`.
 * @throws {Error} If playback is unsupported, `ffplay` cannot start or exits
 * unsuccessfully, the response has no body, or reading the audio input fails.
 */
export async function playAudio(input: NodeJS.ReadableStream | Response | File): Promise<void> {
  if (isNode) {
    return nodejsPlayAudio(input);
  }

  throw new Error(
    'Play audio is not supported in the browser yet. Check out https://npm.im/wavtools as an alternative.',
  );
}

/** Controls microphone selection and when an in-progress recording is finalized. */
type RecordAudioOptions = {
  /** Stops recording when aborted; successful termination returns the captured audio. */
  signal?: AbortSignal;

  /** Zero-based audio-input device number passed to FFmpeg; defaults to `0`. */
  device?: number;

  /** Positive recording duration in milliseconds; nonpositive values disable the timeout. */
  timeout?: number;
};

function removeRecordingAbortListener(signal: AbortSignal | undefined, listener: () => void): void {
  try {
    signal?.removeEventListener('abort', listener);
  } catch {
    // A cleanup callback must not replace the recording's terminal outcome.
  }
}

function nodejsRecordAudio({ signal, device, timeout }: RecordAudioOptions = {}): Promise<File> {
  checkFileSupport();
  return new Promise((resolve, reject) => {
    const data: any[] = [];
    const provider = recordingProviders[platform];
    let ffmpeg: ReturnType<typeof spawn> | undefined;
    let internalSignal: AbortSignal | undefined;
    let wasStopped = false;
    let settled = false;
    let callerAbortObserved = false;
    let timeoutAbortObserved = false;
    let rejectRecording: (error: unknown) => void = reject;

    const collectData = (chunk: Buffer) => {
      if (!settled) {
        data.push(chunk);
      }
    };
    const stopRecording = () => {
      if (!settled && ffmpeg) {
        try {
          wasStopped ||= ffmpeg.kill('SIGTERM');
        } catch (error) {
          rejectRecording(error);
        }
      }
    };
    const stopCallerRecording = () => {
      callerAbortObserved = true;
      stopRecording();
    };
    const stopTimeoutRecording = () => {
      timeoutAbortObserved = true;
      stopRecording();
    };
    const cleanup = () => {
      if (settled) {
        return false;
      }

      settled = true;
      removeRecordingAbortListener(signal, stopCallerRecording);
      removeRecordingAbortListener(internalSignal, stopTimeoutRecording);
      try {
        ffmpeg?.stdout?.removeListener('data', collectData);
      } catch {
        // Continue settling even when the output stream rejects cleanup.
      }
      return true;
    };
    rejectRecording = (error: unknown) => {
      if (cleanup()) {
        reject(error);
      }
    };
    const returnData = () => {
      if (!cleanup()) {
        return;
      }

      const audioBuffer = Buffer.concat(data);
      const audioFile = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });
      resolve(audioFile);
    };

    const observeTimeout = () => {
      internalSignal?.addEventListener('abort', stopTimeoutRecording, { once: true });
      if (settled) {
        removeRecordingAbortListener(internalSignal, stopTimeoutRecording);
        return false;
      }

      if (internalSignal && !timeoutAbortObserved && internalSignal.aborted) {
        stopTimeoutRecording();
      }
      return !settled;
    };
    const observeCaller = () => {
      if (!signal) {
        return;
      }
      if (signal.aborted) {
        stopRecording();
        return;
      }

      signal.addEventListener('abort', stopCallerRecording, { once: true });
      if (settled) {
        removeRecordingAbortListener(signal, stopCallerRecording);
      } else if (!callerAbortObserved && signal.aborted) {
        stopCallerRecording();
      }
    };

    try {
      if (typeof timeout === 'number' && (timeout > 0 || Number.isNaN(timeout))) {
        internalSignal = AbortSignal.timeout(timeout);
      }

      ffmpeg = spawn(
        'ffmpeg',
        [
          '-f',
          provider,
          '-i',
          `:${device ?? 0}`, // default audio input device; adjust as needed
          '-ar',
          DEFAULT_SAMPLE_RATE.toString(),
          '-ac',
          DEFAULT_CHANNELS.toString(),
          '-f',
          'wav',
          'pipe:1',
        ],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );

      ffmpeg.stdout?.on('data', collectData);

      ffmpeg.on('error', (error) => {
        if (!cleanup()) {
          return;
        }

        try {
          console.error(error);
        } catch {
          // A custom logger must not hide the original process failure.
        }
        reject(error);
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0 && !wasStopped) {
          rejectRecording(new Error(`ffmpeg process exited with code ${code}`));
          return;
        }
        returnData();
      });

      if (settled || !observeTimeout()) {
        return;
      }
      observeCaller();
    } catch (error) {
      if (!cleanup()) {
        return;
      }

      try {
        if (!wasStopped) {
          ffmpeg?.kill('SIGTERM');
        }
      } catch {
        // Preserve the original setup error when process termination also fails.
      }
      reject(error);
    }
  });
}

/**
 * Records microphone audio into a mono, 24 kHz WAV `File` named `audio.wav`.
 *
 * This helper is supported only in Node.js-compatible runtimes and requires
 * the `ffmpeg` executable from FFmpeg to be available on `PATH`. Recording
 * continues until the FFmpeg process exits, the supplied signal is aborted, or
 * a positive timeout elapses. Successful cancellation returns the audio captured
 * so far; if sending `SIGTERM` throws, recording rejects with that error.
 *
 * @param options Audio-input device, optional abort signal, and recording timeout.
 * @returns The captured WAV file with MIME type `audio/wav`.
 * @throws {Error} If recording is unsupported, `ffmpeg` cannot start or exits
 * unsuccessfully before an intentional stop, or sending it `SIGTERM` throws.
 */
export async function recordAudio(options: RecordAudioOptions = {}): Promise<File> {
  if (isNode) {
    return nodejsRecordAudio(options);
  }

  throw new Error(
    'Record audio is not supported in the browser. Check out https://npm.im/wavtools as an alternative.',
  );
}
