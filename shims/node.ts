// @ts-ignore
import * as types from "../_shims/node-types.ts";
import { setShims } from "../_shims/registry.ts";
import { getRuntime } from "../_shims/node-runtime.ts";
setShims(getRuntime());

declare module "../_shims/manual-types" {
  export namespace manual {
    // @ts-ignore
    export type Agent = types.Agent;
    // @ts-ignore
    export type fetch = types.fetch;
    // @ts-ignore
    export type Request = types.Request;
    // @ts-ignore
    export type RequestInfo = types.RequestInfo;
    // @ts-ignore
    export type RequestInit = types.RequestInit;
    // @ts-ignore
    export type Response = types.Response;
    // @ts-ignore
    export type ResponseInit = types.ResponseInit;
    // @ts-ignore
    export type ResponseType = types.ResponseType;
    // @ts-ignore
    export type BodyInit = types.BodyInit;
    // @ts-ignore
    export type Headers = types.Headers;
    // @ts-ignore
    export type HeadersInit = types.HeadersInit;
    // @ts-ignore
    export type BlobPropertyBag = types.BlobPropertyBag;
    // @ts-ignore
    export type FilePropertyBag = types.FilePropertyBag;
    // @ts-ignore
    export type FileFromPathOptions = types.FileFromPathOptions;
    // @ts-ignore
    export type FormData = types.FormData;
    // @ts-ignore
    export type File = types.File;
    // @ts-ignore
    export type Blob = types.Blob;
    // @ts-ignore
    export type Readable = types.Readable;
    // @ts-ignore
    export type FsReadStream = types.FsReadStream;
    // @ts-ignore
    export type ReadableStream = types.ReadableStream;
  }
}
