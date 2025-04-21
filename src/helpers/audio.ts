import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { platform, versions } from 'node:process';

const DEFAULT_SAMPLE_RATE = 24000;
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
  return stream instanceof Response;
}

function isFile(stream: NodeJS.ReadableStream | Response | File): stream is File {
  return stream instanceof File;
}

async function nodejsPlayAudio(stream: NodeJS.ReadableStream | Response | File): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const ffplay = spawn('ffplay', ['-autoexit', '-nodisp', '-i', 'pipe:0']);

      if (isResponse(stream)) {
        Readable.fromWeb(stream.body! as any).pipe(ffplay.stdin);
      } else if (isFile(stream)) {
        Readable.fromWeb(stream.stream() as any).pipe(ffplay.stdin);
      } else {
        stream.pipe(ffplay.stdin);
      }

      ffplay.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`ffplay process exited with code ${code}`));
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function playAudio(input: NodeJS.ReadableStream | Response | File): Promise<void> {
  if (isNode) {
    return nodejsPlayAudio(input);
  }

  throw new Error(
    'Play audio is not supported in the browser yet. Check out https://npm.im/wavtools as an alternative.',
  );
}

type RecordAudioOptions = {
  signal?: AbortSignal;
  device?: number;
  timeout?: number;
};

function nodejsRecordAudio({ signal, device, timeout }: RecordAudioOptions = {}): Promise<File> {
  return new Promise((resolve, reject) => {
    const data: Uint8Array[] = [];
    const errorData: Uint8Array[] = [];
    const provider = recordingProviders[platform];
    try {
      const ffmpeg = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
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
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      ffmpeg.stdout.on('data', (chunk) => {
        data.push(chunk);
      });

      ffmpeg.stderr.on('data', (chunk) => {
        errorData.push(chunk);
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });

      ffmpeg.on('close', (code) => {
        if (code === 1) {
          reject(new Error('FFmpeg Error: ' + Buffer.concat(errorData).toString('utf-8')));
        } else {
          resolve(new File(data, 'audio.wav', { type: 'audio/wav' }));
        }
      });

      if (typeof timeout === 'number' && timeout > 0) {
        const internalSignal = AbortSignal.timeout(timeout);
        internalSignal.addEventListener('abort', () => {
          ffmpeg.kill('SIGTERM');
        });
      }

      if (signal) {
        signal.addEventListener('abort', () => {
          ffmpeg.kill('SIGTERM');
        });
      }
    } catch (error) {
      reject(error);
    }
  });
}

export async function recordAudio(options: RecordAudioOptions = {}) {
  if (isNode) {
    return nodejsRecordAudio(options);
  }

  throw new Error(
    'Record audio is not supported in the browser. Check out https://npm.im/wavtools as an alternative.',
  );
}
