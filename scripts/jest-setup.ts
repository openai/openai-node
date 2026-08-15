import { bufferSteadyMultipartUploads } from './mock-server-fetch';

globalThis.fetch = bufferSteadyMultipartUploads(globalThis.fetch);
