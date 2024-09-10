/**
 * Disclaimer: modules in _shims aren't intended to be imported by SDK users.
 */
import { manual } from './manual-types';
import * as auto from 'openai/_shims/auto/types';
import { type RequestOptions } from '../internal/request-options';

type SelectType<Manual, Auto> = unknown extends Manual ? Auto : Manual;

export const kind: string;

// Note: shims will be removed in a follow-on PR
// so we don't need to get this type correct right now
export const fetch: any;

// @ts-ignore
export type Agent = SelectType<manual.Agent, auto.Agent>;

// @ts-ignore
export type Request = SelectType<manual.Request, auto.Request>;
// @ts-ignore
export type RequestInfo = SelectType<manual.RequestInfo, auto.RequestInfo>;
// @ts-ignore
export type RequestDuplex = SelectType<manual.RequestDuplex, auto.RequestDuplex>;

// @ts-ignore
export type ResponseType = SelectType<manual.ResponseType, auto.ResponseType>;
// @ts-ignore
export type BodyInit = SelectType<manual.BodyInit, auto.BodyInit>;

// @ts-ignore
export type HeadersInit = SelectType<manual.HeadersInit, auto.HeadersInit>;

// @ts-ignore
export type BlobPropertyBag = SelectType<manual.BlobPropertyBag, auto.BlobPropertyBag>;
// @ts-ignore
export type FilePropertyBag = SelectType<manual.FilePropertyBag, auto.FilePropertyBag>;
// @ts-ignore
export type FormData = SelectType<manual.FormData, auto.FormData>;
// @ts-ignore
export const FormData: SelectType<typeof manual.FormData, typeof auto.FormData>;
// @ts-ignore
export type File = SelectType<manual.File, auto.File>;
// @ts-ignore
export const File: SelectType<typeof manual.File, typeof auto.File>;
// @ts-ignore
export type Blob = SelectType<manual.Blob, auto.Blob>;
// @ts-ignore
export const Blob: SelectType<typeof manual.Blob, typeof auto.Blob>;

// @ts-ignore
export type Readable = SelectType<manual.Readable, auto.Readable>;
// @ts-ignore
export const Readable: SelectType<typeof manual.Readable, typeof auto.Readable>;
// @ts-ignore
export type FsReadStream = SelectType<manual.FsReadStream, auto.FsReadStream>;
// @ts-ignore
export type ReadableStream = SelectType<manual.ReadableStream, auto.ReadableStream>;
// @ts-ignore
export const ReadableStream: SelectType<typeof manual.ReadableStream, typeof auto.ReadableStream>;

export function getMultipartRequestOptions<T = Record<string, unknown>>(
  form: FormData,
  opts: RequestOptions<T>,
): Promise<RequestOptions<T>>;

export function getDefaultAgent(): any;

export function isFsReadStream(value: any): value is FsReadStream;
export function isReadable(value: any): value is Readable;
export function readableFromWeb(value: ReadableStream): Readable;
