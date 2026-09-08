// File generated from our OpenAPI spec by Castiron. See CONTRIBUTING.md for details.

import type { RequestInit, RequestInfo, BodyInit } from './internal/builtin-types';
import type { HTTPMethod, PromiseOrValue, MergedRequestInit, FinalizedRequestInit } from './internal/types';
import { uuid4 } from './internal/utils/uuid';
import { validatePositiveInteger, isAbsoluteURL, safeJSON, hasOwn } from './internal/utils/values';
import { sleep } from './internal/utils/sleep';
export type { Logger, LogLevel } from './internal/utils/log';
import { castToError, isAbortError } from './internal/errors';
import { addRequestID, defaultParseResponse, type APIResponseProps } from './internal/parse';
import { getPlatformHeaders } from './internal/detect-platform';
import * as Shims from './internal/shims';
import * as Opts from './internal/request-options';
import { stringifyQuery } from './internal/utils/query';
import { VERSION } from './version';
import { resolveDataResidency, type DataResidency } from './internal/data-residency';
export type { DataResidency } from './internal/data-residency';
import * as Errors from './core/error';
import * as Pagination from './core/pagination';
import type { WorkloadIdentity, X509Credential, X509WorkloadIdentity } from './auth/types';
import { WorkloadIdentityAuth } from './auth/workload-identity-auth';
import { X509_API_BASE_URL, assertX509APIOrigin } from './internal/auth/x509-api-origin';
import {
  X509WorkloadIdentityAuth,
  assertX509RequestOptions,
  isX509WorkloadIdentity,
  snapshotX509RequestOptions,
} from './internal/auth/x509-workload-identity-auth';
import type { X509Transport } from './internal/auth/x509-transport-registry';
import {
  normalizeX509CredentialOptions,
  prepareX509ClientClone,
} from './internal/auth/x509-credential-options';
import { isTransientX509ConnectionError, markApprovedX509Client } from '#x509-transport-state';
import { OAuthError, SubjectTokenProviderError } from './core/error';
import {
  type ConversationCursorPageParams,
  ConversationCursorPageResponse,
  type CursorPageParams,
  CursorPageResponse,
  type NextCursorPageParams,
  NextCursorPageResponse,
  PageResponse,
} from './core/pagination';
import * as Uploads from './core/uploads';
import * as API from './resources/index';
import { APIPromise } from './core/api-promise';
import {
  Batch,
  BatchCreateParams,
  BatchError,
  BatchListParams,
  BatchRequestCounts,
  BatchUsage,
  Batches,
  BatchesPage,
} from './resources/batches';
import {
  Completion,
  CompletionChoice,
  CompletionCreateParams,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  CompletionUsage,
  Completions,
} from './resources/completions';
import {
  ContentProvenanceCheck,
  ContentProvenanceCheckCreateParams,
  ContentProvenanceChecks,
} from './resources/content-provenance-checks';
import {
  CreateEmbeddingResponse,
  Embedding,
  EmbeddingCreateParams,
  EmbeddingModel,
  Embeddings,
} from './resources/embeddings';
import {
  FileContent,
  FileCreateParams,
  FileDeleted,
  FileListParams,
  FileObject,
  FileObjectsPage,
  FilePurpose,
  Files,
} from './resources/files';
import {
  Image,
  ImageCreateVariationParams,
  ImageEditCompletedEvent,
  ImageEditParams,
  ImageEditParamsNonStreaming,
  ImageEditParamsStreaming,
  ImageEditPartialImageEvent,
  ImageEditStreamEvent,
  ImageGenCompletedEvent,
  ImageGenPartialImageEvent,
  ImageGenStreamEvent,
  ImageGenerateParams,
  ImageGenerateParamsNonStreaming,
  ImageGenerateParamsStreaming,
  ImageModel,
  Images,
  ImagesResponse,
} from './resources/images';
import { Model, ModelDeleted, Models, ModelsPage } from './resources/models';
import {
  Moderation,
  ModerationCreateParams,
  ModerationCreateResponse,
  ModerationImageURLInput,
  ModerationModel,
  ModerationMultiModalInput,
  ModerationTextInput,
  Moderations,
} from './resources/moderations';
import {
  ImageInputReferenceParam,
  Video,
  VideoCreateCharacterParams,
  VideoCreateCharacterResponse,
  VideoCreateError,
  VideoCreateParams,
  VideoDeleteResponse,
  VideoDownloadContentParams,
  VideoEditParams,
  VideoExtendParams,
  VideoGetCharacterResponse,
  VideoListParams,
  VideoModel,
  VideoRemixParams,
  VideoSeconds,
  VideoSize,
  Videos,
  VideosPage,
} from './resources/videos';
import { Admin } from './resources/admin/admin';
import { Audio, AudioModel, AudioResponseFormat } from './resources/audio/audio';
import { Beta } from './resources/beta/beta';
import { Chat } from './resources/chat/chat';
import {
  ContainerCreateParams,
  ContainerCreateResponse,
  ContainerListParams,
  ContainerListResponse,
  ContainerListResponsesPage,
  ContainerRetrieveResponse,
  Containers,
} from './resources/containers/containers';
import { Conversations } from './resources/conversations/conversations';
import {
  EvalCreateParams,
  EvalCreateResponse,
  EvalCustomDataSourceConfig,
  EvalDeleteResponse,
  EvalListParams,
  EvalListResponse,
  EvalListResponsesPage,
  EvalRetrieveResponse,
  EvalStoredCompletionsDataSourceConfig,
  EvalUpdateParams,
  EvalUpdateResponse,
  Evals,
} from './resources/evals/evals';
import { FineTuning } from './resources/fine-tuning/fine-tuning';
import { Graders } from './resources/graders/graders';
import { Realtime } from './resources/realtime/realtime';
import { Responses } from './resources/responses/responses';
import { Safety } from './resources/safety/safety';
import {
  DeletedSkill,
  Skill,
  SkillCreateParams,
  SkillList,
  SkillListParams,
  SkillUpdateParams,
  Skills,
  SkillsPage,
} from './resources/skills/skills';
import {
  Upload,
  UploadCompleteParams,
  UploadCreateParams,
  Uploads as UploadsAPIUploads,
} from './resources/uploads/uploads';
import {
  AutoFileChunkingStrategyParam,
  FileChunkingStrategy,
  FileChunkingStrategyParam,
  OtherFileChunkingStrategyObject,
  StaticFileChunkingStrategy,
  StaticFileChunkingStrategyObject,
  StaticFileChunkingStrategyObjectParam,
  VectorStore,
  VectorStoreCreateParams,
  VectorStoreDeleted,
  VectorStoreListParams,
  VectorStoreSearchParams,
  VectorStoreSearchResponse,
  VectorStoreSearchResponsesPage,
  VectorStoreUpdateParams,
  VectorStores,
  VectorStoresPage,
} from './resources/vector-stores/vector-stores';
import { Webhooks } from './resources/webhooks/webhooks';
import {
  ChatCompletion,
  ChatCompletionAllowedToolChoice,
  ChatCompletionAllowedTools,
  ChatCompletionAssistantMessageParam,
  ChatCompletionAudio,
  ChatCompletionAudioParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartInputAudio,
  ChatCompletionContentPartRefusal,
  ChatCompletionContentPartText,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCustomTool,
  ChatCompletionDeleted,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionFunctionCallOption,
  ChatCompletionFunctionMessageParam,
  ChatCompletionFunctionTool,
  ChatCompletionListParams,
  ChatCompletionMessage,
  ChatCompletionMessageCustomToolCall,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionModality,
  ChatCompletionNamedToolChoice,
  ChatCompletionNamedToolChoiceCustom,
  ChatCompletionPredictionContent,
  ChatCompletionReasoningEffort,
  ChatCompletionRole,
  ChatCompletionStoreMessage,
  ChatCompletionStreamOptions,
  ChatCompletionSystemMessageParam,
  ChatCompletionTokenLogprob,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionToolMessageParam,
  ChatCompletionUpdateParams,
  ChatCompletionUserMessageParam,
  ChatCompletionsPage,
} from './resources/chat/completions/completions';
import { type Fetch } from './internal/builtin-types';
import { isRunningInBrowser } from './internal/detect-platform';
import {
  HeadersLike,
  NullableHeaders,
  buildHeaders,
  captureHeaderReads,
  snapshotHeaders,
  getRequestHeaders,
  getPlatformHeader,
  hasNativeHeadersBrand,
  createWorkloadHeaderSnapshots,
  canReplayHeaderInput,
  canPreserveHeaderInput,
  type WorkloadHeaderSnapshots,
} from './internal/headers';
import { configureProvider, type Provider, type ProviderRuntime } from './internal/provider';
import { FinalRequestOptions, RequestOptions } from './internal/request-options';
import { readEnv } from './internal/utils/env';
import {
  WorkloadTokenProvenance,
  bearerToken,
  type WorkloadCredentialUsage,
} from './internal/auth/workload-token-provenance';
import {
  type LogLevel,
  type Logger,
  formatRequestDetails,
  loggerFor,
  parseLogLevel,
  redactURL,
} from './internal/utils/log';
import { isEmptyObj } from './internal/utils/values';

function isRunningInBrowserOrBrowserWorker(): boolean {
  if (isRunningInBrowser()) return true;

  const scope = globalThis as any;
  return (
    typeof scope.WorkerGlobalScope === 'function' &&
    scope instanceof scope.WorkerGlobalScope &&
    typeof scope.WorkerNavigator === 'function' &&
    scope.navigator instanceof scope.WorkerNavigator &&
    typeof scope.navigator?.userAgent === 'string' &&
    scope.navigator.userAgent !== 'Cloudflare-Workers' &&
    scope.process?.versions?.node === undefined &&
    scope.Deno === undefined &&
    scope.Bun === undefined &&
    scope.EdgeRuntime === undefined &&
    scope.WebSocketPair === undefined
  );
}

const WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER = 'workload-identity-auth';
const suppliesWorkloadAuthorization = (headers: NullableHeaders): boolean => {
  const authorization = headers.values.get('authorization');
  return (
    headers.nulls.has('authorization') ||
    (authorization !== null && authorization !== `Bearer ${WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER}`)
  );
};
type WorkloadIdentityRequest = {
  context: object;
  bindings: Set<object>;
  authorization: string | undefined;
  credential: WorkloadCredentialUsage | undefined;
  responses: WeakMap<Response, boolean>;
  responseBodies: WeakMap<object, boolean>;
  cloneTrackedResponses: Set<Response>;
  finished: boolean;
};
type ResponseCloneTracker = {
  previous: PropertyDescriptor | undefined;
  installed: PropertyDescriptor;
  requests: Set<WorkloadIdentityRequest>;
};
const responseCloneTrackers = new WeakMap<Response, ResponseCloneTracker>();
const nativeResponseBodyGetter = globalThis.Response
  ? Object.getOwnPropertyDescriptor(globalThis.Response.prototype, 'body')?.get
  : undefined;
const responseBodyIdentity = (response: Response): object | undefined => {
  try {
    const body = nativeResponseBodyGetter?.call(response);
    return typeof body === 'object' && body !== null ? body : undefined;
  } catch {
    return undefined;
  }
};
const responseUsedWorkloadToken = (request: WorkloadIdentityRequest, response: Response): boolean => {
  const used = request.responses.get(response);
  if (used !== undefined) {
    return used;
  }
  const body = responseBodyIdentity(response);
  return body !== undefined && request.responseBodies.get(body) === true;
};
const recordWorkloadIdentityResponseBody = (
  request: WorkloadIdentityRequest,
  response: Response,
  usedWorkloadToken: boolean,
) => {
  const body = responseBodyIdentity(response);
  if (body) {
    request.responseBodies.set(body, usedWorkloadToken && request.responseBodies.get(body) !== false);
  }
};

const hasInstalledResponseClone = (response: Response, tracker: ResponseCloneTracker): boolean => {
  const current = Object.getOwnPropertyDescriptor(response, 'clone');
  return 'value' in tracker.installed
    ? current?.value === tracker.installed.value
    : current?.get === tracker.installed.get && current?.set === tracker.installed.set;
};

const recordWorkloadIdentityResponse = (
  request: WorkloadIdentityRequest,
  response: Response,
  usedWorkloadToken: boolean,
) => {
  if (request.finished) return;
  const prior = request.responses.get(response);
  const selectedUsage = prior === undefined ? usedWorkloadToken : prior && usedWorkloadToken;
  request.responses.set(response, selectedUsage);
  recordWorkloadIdentityResponseBody(request, response, selectedUsage);
  let trackedRequests = new Set<WorkloadIdentityRequest>([request]);
  const existing = responseCloneTrackers.get(response);
  try {
    if (existing) {
      if (hasInstalledResponseClone(response, existing)) {
        existing.requests.add(request);
        request.cloneTrackedResponses.add(response);
        return;
      }
      responseCloneTrackers.delete(response);
      trackedRequests = new Set([...existing.requests, request]);
    }
    const previous = Object.getOwnPropertyDescriptor(response, 'clone');
    let cloneDescriptor = previous;
    if (!previous) {
      for (let prototype = Object.getPrototypeOf(response); prototype && !cloneDescriptor;) {
        cloneDescriptor = Object.getOwnPropertyDescriptor(prototype, 'clone');
        prototype = Object.getPrototypeOf(prototype);
      }
    }
    if (!cloneDescriptor) return;
    let tracker!: ResponseCloneTracker;
    const captureBodyConflicts = (...sources: (Response | undefined)[]) => {
      const conflicts = new Set<WorkloadIdentityRequest>();
      for (const activeRequest of tracker.requests) {
        for (const source of sources) {
          const body = source && responseBodyIdentity(source);
          if (body && activeRequest.responseBodies.get(body) === false) {
            conflicts.add(activeRequest);
          }
        }
      }
      return conflicts;
    };
    const trackCopy = (
      source: Response,
      copy: Response,
      alternateSource?: Response,
      bodyConflicts = new Set<WorkloadIdentityRequest>(),
    ) => {
      for (const activeRequest of tracker.requests) {
        let selectedUsage = activeRequest.responses.get(source);
        if (selectedUsage !== undefined) {
          // Native clone tees and replaces the source body stream before returning its copy.
          recordWorkloadIdentityResponseBody(
            activeRequest,
            source,
            selectedUsage && !bodyConflicts.has(activeRequest),
          );
        }
        if (alternateSource && alternateSource !== source) {
          const alternateUsage = activeRequest.responses.get(alternateSource);
          if (alternateUsage !== undefined) {
            recordWorkloadIdentityResponseBody(
              activeRequest,
              alternateSource,
              alternateUsage && !bodyConflicts.has(activeRequest),
            );
          }
          selectedUsage =
            selectedUsage === undefined && alternateUsage === undefined
              ? undefined
              : selectedUsage === true && alternateUsage === true;
        }
        if (selectedUsage !== undefined) {
          recordWorkloadIdentityResponse(
            activeRequest,
            copy,
            selectedUsage && !bodyConflicts.has(activeRequest),
          );
        }
      }
      return copy;
    };
    let installed: PropertyDescriptor;
    if ('value' in cloneDescriptor) {
      if (typeof cloneDescriptor.value !== 'function') return;
      const clone = cloneDescriptor.value;
      installed = {
        configurable: true,
        enumerable: !!cloneDescriptor.enumerable,
        writable: cloneDescriptor.writable ?? true,
        value: function cloneTrackedResponse(this: Response) {
          const bodyConflicts = captureBodyConflicts(this);
          return trackCopy(this, Reflect.apply(clone, this, []) as Response, undefined, bodyConflicts);
        },
      };
    } else {
      if (!cloneDescriptor.get) return;
      const getClone = cloneDescriptor.get;
      const setClone = cloneDescriptor.set;
      installed = {
        configurable: true,
        enumerable: !!cloneDescriptor.enumerable,
        get: function getTrackedResponseClone(this: Response) {
          const source = this;
          const clone = Reflect.apply(getClone, this, []) as unknown;
          if (typeof clone !== 'function') return clone;
          return function cloneTrackedResponse(this: Response) {
            const bodyConflicts = captureBodyConflicts(source, this);
            return trackCopy(source, Reflect.apply(clone, this, []) as Response, this, bodyConflicts);
          };
        },
        ...(setClone
          ? {
              set: function setTrackedResponseClone(this: Response, value: unknown) {
                Reflect.apply(setClone, this, [value]);
              },
            }
          : undefined),
      };
    }
    tracker = {
      previous,
      requests: trackedRequests,
      installed,
    };
    Object.defineProperty(response, 'clone', installed);
    responseCloneTrackers.set(response, tracker);
    for (const activeRequest of trackedRequests) {
      activeRequest.cloneTrackedResponses.add(response);
    }
  } catch {
    // Non-extensible, accessor-shadowed, or uninspectable responses retain conservative attribution.
  }
};

const releaseWorkloadIdentityResponseClones = (request: WorkloadIdentityRequest) => {
  for (const response of request.cloneTrackedResponses) {
    const tracker = responseCloneTrackers.get(response);
    tracker?.requests.delete(request);
    if (!tracker || tracker.requests.size !== 0) continue;
    try {
      if (responseCloneTrackers.get(response) !== tracker) {
        continue;
      }
      responseCloneTrackers.delete(response);
      if (!hasInstalledResponseClone(response, tracker)) continue;
      if (tracker.previous) {
        Object.defineProperty(response, 'clone', tracker.previous);
      } else {
        Reflect.deleteProperty(response, 'clone');
      }
    } catch {
      // A hook may harden a response after dispatch; the private wrapper carries no credential.
    }
  }
  request.cloneTrackedResponses.clear();
};
const inheritedDataResidencySelection = Symbol('inheritedDataResidencySelection');
type InternalClientOptions = ClientOptions & { [inheritedDataResidencySelection]?: boolean };

export type ApiKeySetter = () => Promise<string>;

export interface ClientOptions {
  /**
   * API key used for authentication.
   *
   * - Accepts either a static string or an async function that resolves to a string.
   * - Defaults to process.env['OPENAI_API_KEY'].
   * - When a function is provided, it is invoked before each request so you can rotate
   *   or refresh credentials at runtime.
   * - The function must return a non-empty string; otherwise an OpenAIError is thrown.
   * - If the function throws, the error is wrapped in an OpenAIError with the original
   *   error available as `cause`.
   * - Mutually exclusive with `workloadIdentity`.
   */
  apiKey?: string | ApiKeySetter | null | undefined;

  /**
   * Defaults to process.env['OPENAI_ADMIN_KEY'].
   */
  adminAPIKey?: string | null | undefined;

  /**
   * Defaults to process.env['OPENAI_ORG_ID'].
   */
  organization?: string | null | undefined;

  /**
   * Defaults to process.env['OPENAI_PROJECT_ID'].
   */
  project?: string | null | undefined;

  /**
   * Defaults to process.env['OPENAI_WEBHOOK_SECRET'].
   */
  webhookSecret?: string | null | undefined;

  /**
   * Override the default base URL for the API, e.g., "https://api.example.com/v2/"
   *
   * Defaults to process.env['OPENAI_BASE_URL'].
   */
  baseURL?: string | null | undefined;

  /**
   * Select an OpenAI regional endpoint. This overrides an inherited or environment
   * base URL and is mutually exclusive with an explicit `baseURL` or `provider`.
   * Availability depends on your project and model; no fallback is performed.
   * `null` and `undefined` leave ordinary base URL resolution unchanged.
   */
  dataResidency?: DataResidency | null | undefined;

  /**
   * The maximum amount of time (in milliseconds) that the client should wait for a response
   * from the server before timing out a single request.
   *
   * Note that request timeouts are retried by default, so in a worst-case scenario you may wait
   * much longer than this timeout before the promise succeeds or fails.
   *
   * Node.js fetch enforces independent response-header and body-inactivity timeouts, typically
   * defaulting to five minutes, even when this timeout is longer. To increase them, install
   * `undici` and configure an Agent with the matching fetch implementation:
   *
   * ```ts
   * import { Agent, fetch } from 'undici';
   *
   * const timeout = 20 * 60 * 1000;
   * const client = new OpenAI({
   *   timeout,
   *   fetch,
   *   fetchOptions: {
   *     dispatcher: new Agent({ headersTimeout: timeout, bodyTimeout: timeout }),
   *   },
   * });
   * ```
   *
   * @unit milliseconds
   */
  timeout?: number | undefined;

  /**
   * Additional `RequestInit` options to be passed to `fetch` calls.
   * Properties will be overridden by per-request `fetchOptions`.
   */
  fetchOptions?: MergedRequestInit | undefined;

  /**
   * Specify a custom `fetch` function implementation.
   *
   * If not provided, we expect that `fetch` is defined globally.
   */
  fetch?: Fetch | undefined;

  /**
   * The maximum number of times that the client will retry a request in case of a
   * temporary failure, like a network error or a 5XX error from the server.
   *
   * @default 2
   */
  maxRetries?: number | undefined;

  /**
   * Default headers to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * header to `null` in request options.
   */
  defaultHeaders?: HeadersLike | undefined;

  /**
   * Default query parameters to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * param to `undefined` in request options.
   */
  defaultQuery?: Record<string, string | undefined> | undefined;

  /**
   * By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   * Only set this option to `true` if you understand the risks and have appropriate mitigations in place.
   */
  dangerouslyAllowBrowser?: boolean | undefined;

  /**
   * Set the log level.
   *
   * Defaults to process.env['OPENAI_LOG'] or 'warn' if it isn't set.
   */
  logLevel?: LogLevel | undefined;

  /**
   * Set the logger.
   *
   * Defaults to globalThis.console.
   */
  logger?: Logger | undefined;

  /**
   * Workload identity configuration for OAuth2 token exchange authentication.
   * Mutually exclusive with `apiKey`.
   */
  workloadIdentity?: WorkloadIdentity | X509WorkloadIdentity | undefined;

  /** Approved, frozen Node.js certificate transport required only for X.509 workload identity. */
  x509Transport?: X509Transport | undefined;

  /** First-class certificate credential created with `fromX509` from `openai/auth/x509-transport`. */
  credential?: X509Credential | undefined;

  /**
   * Configure this client to use a third-party API provider.
   * Mutually exclusive with top-level authentication and `baseURL` options.
   */
  provider?: Provider | undefined;
}

/**
 * API Client for interfacing with the OpenAI API.
 */
export class OpenAI {
  apiKey: string | null;
  adminAPIKey: string | null;
  organization: string | null;
  project: string | null;
  webhookSecret: string | null;

  baseURL: string;
  maxRetries: number;
  timeout: number;
  logger: Logger;
  logLevel: LogLevel | undefined;
  fetchOptions: MergedRequestInit | undefined;

  private fetch: Fetch;
  #encoder: Opts.RequestEncoder;
  #x509Authentication: X509WorkloadIdentityAuth | undefined;
  #x509Credential: X509Credential | undefined;
  #x509Fetch: Fetch | undefined;
  // Preserve an explicit global selection without storing a second routing URL.
  #explicitDataResidency = false;
  #responseAttempts = new WeakMap<
    AbortController,
    {
      timeout: number;
      retriesRemaining: number;
      hasStreamingBody: boolean;
      workloadHeaders?: WorkloadHeaderSnapshots;
      authentication?: X509WorkloadIdentityAuth;
      helperMethod?: unknown;
      continueRequest?: <T>(operation: () => Promise<T>) => Promise<T>;
    }
  >();
  protected idempotencyHeader?: string;
  protected _options: ClientOptions;
  private _provider: ProviderRuntime | undefined;
  private _workloadIdentityAuth?: WorkloadIdentityAuth | X509WorkloadIdentityAuth;
  #workloadIdentityRequests = new WeakMap<object, Set<WorkloadIdentityRequest>>();
  #workloadTokenProvenance = new WorkloadTokenProvenance((values) => buildHeaders([values]));

  /**
   * API Client for interfacing with the OpenAI API.
   *
   * @param {string | null | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? null]
   * @param {string | null | undefined} [opts.adminAPIKey=process.env['OPENAI_ADMIN_KEY'] ?? null]
   * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
   * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
   * @param {string | null | undefined} [opts.webhookSecret=process.env['OPENAI_WEBHOOK_SECRET'] ?? null]
   * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
   * @param {Provider} [opts.provider] - Configure a third-party API provider. Mutually exclusive with top-level authentication and base URL options.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor(clientOptions: ClientOptions = {}) {
    const { credential, options: normalizedOptions } = normalizeX509CredentialOptions(clientOptions);
    clientOptions = normalizedOptions;
    const residencyBaseURL = resolveDataResidency(clientOptions);
    const provider = clientOptions.provider;
    const {
      baseURL = provider ? null : readEnv('OPENAI_BASE_URL'),
      dataResidency: _dataResidency,
      [inheritedDataResidencySelection]: inheritedResidencySelection = false,
      apiKey = provider ? null : (readEnv('OPENAI_API_KEY') ?? null),
      adminAPIKey = provider ? null : (readEnv('OPENAI_ADMIN_KEY') ?? null),
      organization = provider ? null : (readEnv('OPENAI_ORG_ID') ?? null),
      project = provider ? null : (readEnv('OPENAI_PROJECT_ID') ?? null),
      webhookSecret = readEnv('OPENAI_WEBHOOK_SECRET') ?? null,
      workloadIdentity,
      x509Transport,
      credential: _credential,
      ...opts
    } = clientOptions as InternalClientOptions;
    if (provider) {
      const conflictingOptions = (
        ['apiKey', 'adminAPIKey', 'workloadIdentity', 'x509Transport', 'baseURL', 'dataResidency'] as const
      ).filter((key) => (key === 'workloadIdentity' ? workloadIdentity : clientOptions[key]) != null);
      if (conflictingOptions.length) {
        throw new Errors.OpenAIError(
          `The \`provider\` option cannot be used with ${conflictingOptions
            .map((key) => `\`${key}\``)
            .join(', ')}. Configure authentication and the base URL through the provider instead.`,
        );
      }
    }
    const identity = isX509WorkloadIdentity(workloadIdentity)
      ? { x509: workloadIdentity, legacy: undefined }
      : { x509: undefined, legacy: workloadIdentity };
    const x509Identity = identity.x509;
    const usesX509Identity = x509Identity !== undefined;
    const providerRuntime = provider ? configureProvider(provider) : undefined;
    const options: ClientOptions = {
      apiKey,
      adminAPIKey,
      organization,
      project,
      webhookSecret,
      workloadIdentity,
      x509Transport,
      provider,
      ...opts,
      baseURL:
        providerRuntime?.baseURL ??
        residencyBaseURL ??
        (baseURL || (usesX509Identity ? X509_API_BASE_URL : `https://api.openai.com/v1`)),
    };

    if (x509Transport && !usesX509Identity) {
      throw new Errors.OpenAIError('An X.509 transport requires an X.509 workload identity.');
    }

    if (usesX509Identity) {
      if (residencyBaseURL !== undefined || inheritedResidencySelection) {
        throw new Errors.OpenAIError('X.509 workload identity does not support data residency selection.');
      }
      if (clientOptions.fetch !== undefined) {
        throw new Errors.OpenAIError(
          'X.509 workload identity does not support a custom fetch implementation.',
        );
      }
      assertX509APIOrigin(options.baseURL!);
      assertX509RequestOptions(options.fetchOptions);
      if (
        this.fetchWithAuth !== OpenAI.prototype.fetchWithAuth ||
        this.fetchWithTimeout !== OpenAI.prototype.fetchWithTimeout
      ) {
        throw new Errors.OpenAIError(
          'X.509 workload identity does not support overridden fetch dispatch hooks.',
        );
      }
    }

    if (apiKey && workloadIdentity) {
      throw new Errors.OpenAIError('The `apiKey` and `workloadIdentity` options are mutually exclusive');
    }

    if (!providerRuntime && !apiKey && !adminAPIKey && !workloadIdentity) {
      throw new Errors.OpenAIError(
        'Missing credentials. Please pass an `apiKey`, `workloadIdentity`, `adminAPIKey`, or set the `OPENAI_API_KEY` or `OPENAI_ADMIN_KEY` environment variable.',
      );
    }

    if (!options.dangerouslyAllowBrowser && isRunningInBrowserOrBrowserWorker()) {
      throw new Errors.OpenAIError(
        "It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n",
      );
    }

    this.baseURL = options.baseURL!;
    this.#explicitDataResidency = residencyBaseURL !== undefined || inheritedResidencySelection;
    this.timeout = options.timeout ?? OpenAI.DEFAULT_TIMEOUT; /* 10 minutes */
    this.logger = options.logger ?? console;
    const defaultLogLevel = 'warn';
    // Set default logLevel early so that we can log a warning in parseLogLevel.
    this.logLevel = defaultLogLevel;
    this.logLevel =
      parseLogLevel(options.logLevel, 'ClientOptions.logLevel', this) ??
      parseLogLevel(readEnv('OPENAI_LOG'), "process.env['OPENAI_LOG']", this) ??
      defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? Shims.getDefaultFetch();
    this.#encoder = Opts.FallbackEncoder;

    const customHeadersEnv = provider || credential ? undefined : readEnv('OPENAI_CUSTOM_HEADERS');
    if (customHeadersEnv) {
      const parsed: Record<string, string> = {};
      for (const line of customHeadersEnv.split('\n')) {
        const colon = line.indexOf(':');
        if (colon >= 0) {
          parsed[line.substring(0, colon).trim()] = line.substring(colon + 1).trim();
        }
      }
      options.defaultHeaders = buildHeaders([parsed, options.defaultHeaders]);
    }

    this._options = options;
    this._provider = providerRuntime;

    if (x509Identity) {
      const authentication = new X509WorkloadIdentityAuth(x509Identity, x509Transport, organization, project);
      this._workloadIdentityAuth = authentication;
      this.#x509Authentication = authentication;
      this.#x509Credential = credential;
      this.#x509Fetch = authentication.fetch();
      this.fetch = this.#x509Fetch;
      markApprovedX509Client(this);
    } else if (identity.legacy) {
      this._workloadIdentityAuth = new WorkloadIdentityAuth(identity.legacy, this.fetch);
    }

    this.apiKey = typeof apiKey === 'string' ? apiKey : null;
    this.adminAPIKey = adminAPIKey;
    this.organization = organization;
    this.project = project;
    this.webhookSecret = webhookSecret;
  }

  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options: Partial<ClientOptions>): this {
    const residencyBaseURL = resolveDataResidency(options);
    const x509Authentication = this.#x509Authentication;
    const inheritedOptions: ClientOptions = {
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: this.#x509Authentication ? undefined : this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this._options.apiKey,
      adminAPIKey: this.adminAPIKey,
      workloadIdentity: x509Authentication?.identitySnapshot() ?? this._options.workloadIdentity,
      x509Transport: this._options.x509Transport,
      organization: this.organization,
      project: this.project,
      webhookSecret: this.webhookSecret,
    };
    const { credential, provider } = prepareX509ClientClone(
      inheritedOptions,
      options,
      this.#x509Credential,
      x509Authentication !== undefined,
    );
    if (residencyBaseURL !== undefined) {
      delete inheritedOptions.baseURL;
    }

    const clientOptions: InternalClientOptions = {
      ...inheritedOptions,
      ...options,
      credential,
      provider,
      [inheritedDataResidencySelection]:
        this.#explicitDataResidency &&
        residencyBaseURL === undefined &&
        !hasOwn(options, 'baseURL') &&
        options.credential === undefined &&
        !provider,
    };
    const client = new (this.constructor as any as new (props: ClientOptions) => typeof this)(clientOptions);
    if (provider && new URL(client.baseURL).origin !== new URL(this.baseURL).origin) {
      Object.assign(client._options, {
        defaultHeaders: options.defaultHeaders,
        defaultQuery: options.defaultQuery,
        fetchOptions: options.fetchOptions,
        fetch: options.fetch,
      });
      client.fetchOptions = options.fetchOptions;
      client.fetch = options.fetch ?? Shims.getDefaultFetch();
      client.organization = options.organization ?? null;
      client.project = options.project ?? null;
    }
    if (
      this.#x509Authentication &&
      client.#x509Authentication &&
      this.baseURL === client.baseURL &&
      this.#x509Authentication.matches(client.#x509Authentication)
    ) {
      client._workloadIdentityAuth = this.#x509Authentication;
      client.#x509Authentication = this.#x509Authentication;
      client.#x509Fetch = this.#x509Fetch;
    }
    return client;
  }

  /**
   * Check whether the base URL is set to its default.
   */
  #baseURLOverridden(): boolean {
    return (
      this.#explicitDataResidency ||
      this._provider !== undefined ||
      this.baseURL !== 'https://api.openai.com/v1'
    );
  }

  protected defaultQuery(): Record<string, string | undefined> | undefined {
    return this._options.defaultQuery;
  }

  protected validateHeaders(
    { values, nulls }: NullableHeaders,
    schemes: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean } = {
      bearerAuth: true,
      adminAPIKeyAuth: true,
    },
  ) {
    if (values.get('authorization') || values.get('api-key')) {
      return;
    }
    if (nulls.has('authorization') || nulls.has('api-key')) {
      return;
    }

    if (this._workloadIdentityAuth && schemes.bearerAuth) {
      return;
    }

    throw new Error(
      'Could not resolve authentication method. Expected either apiKey or adminAPIKey to be set. Or for one of the "Authorization" or "api-key" headers to be explicitly omitted',
    );
  }

  /**
   * Resolves authentication headers for one request attempt.
   * SDK-produced results carry workload-token ownership through delegating hooks.
   * Forward the opaque context when reconstructing results outside SDK header helpers.
   */
  protected async authHeaders(
    opts: FinalRequestOptions,
    schemes: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean } = {
      bearerAuth: true,
      adminAPIKeyAuth: true,
    },
    context?: object,
  ): Promise<NullableHeaders | undefined> {
    context ??= this.#workloadTokenProvenance.authenticationScope(opts, context)?.context;
    const authentication = this.#x509Authentication ?? this._workloadIdentityAuth;
    if (
      authentication instanceof X509WorkloadIdentityAuth &&
      schemes.adminAPIKeyAuth &&
      this.adminAPIKey !== null
    ) {
      return await this.adminAPIKeyAuth(opts);
    }
    let bearerHeaders = schemes.bearerAuth ? await this.bearerAuth(opts, context) : undefined;
    bearerHeaders = this.#workloadTokenProvenance.recover(bearerHeaders, opts, context);
    const headers = buildHeaders([
      bearerHeaders,
      schemes.adminAPIKeyAuth ? await this.adminAPIKeyAuth(opts) : null,
    ]);
    return this.#workloadTokenProvenance.recover(headers, opts, context);
  }

  /** Resolves bearer authentication with result-owned workload provenance. */
  protected async bearerAuth(
    opts: FinalRequestOptions,
    context?: object,
  ): Promise<NullableHeaders | undefined> {
    const authentication = this.#x509Authentication ?? this._workloadIdentityAuth;
    const workloadScope = this.#workloadTokenProvenance.authenticationScope(opts, context);
    if (authentication) {
      if (authentication instanceof X509WorkloadIdentityAuth) {
        if (
          authentication === this._workloadIdentityAuth &&
          (this.fetchWithAuth !== OpenAI.prototype.fetchWithAuth ||
            this.fetchWithTimeout !== OpenAI.prototype.fetchWithTimeout)
        ) {
          throw new Errors.OpenAIError(
            'X.509 workload identity does not support overridden fetch dispatch hooks.',
          );
        }
        const snapshots = authentication.headerSnapshots();
        if (
          !X509WorkloadIdentityAuth.shouldAuthenticate(
            opts,
            snapshots.defaultHeaders,
            snapshots.requestHeaders,
          )
        ) {
          return undefined;
        }
      }
      const token =
        authentication instanceof X509WorkloadIdentityAuth
          ? await authentication.getToken(opts, {
              apiURL: authentication.requestAPIURL(),
              ...authentication.headerSnapshots(),
              ...authentication.requestSnapshot(),
              signal: authentication.effectiveSignal(),
              ...authentication.tenantSnapshot(),
            })
          : await authentication.getToken();
      const headers = buildHeaders([{ Authorization: `Bearer ${token}` }]);
      if (!(authentication instanceof X509WorkloadIdentityAuth)) {
        this.#workloadTokenProvenance.issue(headers, token, workloadScope?.record(token));
      }
      return headers;
    }
    if (this.apiKey == null) {
      return undefined;
    }
    return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
  }

  protected async adminAPIKeyAuth(opts: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    if (this.adminAPIKey == null) {
      return undefined;
    }
    return buildHeaders([{ Authorization: `Bearer ${this.adminAPIKey}` }]);
  }

  protected stringifyQuery(query: object | Record<string, unknown>): string {
    return stringifyQuery(query);
  }

  private getUserAgent(): string {
    return `${this.constructor.name}/JS ${VERSION}`;
  }

  protected defaultIdempotencyKey(): string {
    return `stainless-node-retry-${uuid4()}`;
  }

  protected makeStatusError(
    status: number,
    error: Object,
    message: string | undefined,
    headers: Headers,
  ): Errors.APIError {
    const normalizedError =
      error && typeof error === 'object' && (error as { error?: unknown }).error == null ? { error } : error;
    return Errors.APIError.generate(status, normalizedError, message, headers);
  }

  async _callApiKey(): Promise<boolean> {
    if (this._provider) return false;

    const apiKey = this._options.apiKey;
    if (typeof apiKey !== 'function') return false;

    let token: unknown;
    try {
      token = await apiKey();
    } catch (err: any) {
      if (err instanceof Errors.OpenAIError) throw err;
      throw new Errors.OpenAIError(
        `Failed to get token from 'apiKey' function: ${err.message}`,
        // @ts-ignore
        { cause: err },
      );
    }

    if (typeof token !== 'string' || !token) {
      throw new Errors.OpenAIError(
        `Expected 'apiKey' function argument to return a string but it returned ${token}`,
      );
    }
    this.apiKey = token;
    return true;
  }

  buildURL(
    path: string,
    query: Record<string, unknown> | null | undefined,
    defaultBaseURL?: string | undefined,
  ): string {
    const baseURL = (!this.#baseURLOverridden() && defaultBaseURL) || this.baseURL;
    const url = isAbsoluteURL(path)
      ? new URL(path)
      : new URL(baseURL + (baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path));

    const defaultQuery = this.defaultQuery();
    const pathQuery = Object.fromEntries(url.searchParams);
    if (!isEmptyObj(defaultQuery) || !isEmptyObj(pathQuery)) {
      query = { ...pathQuery, ...defaultQuery, ...query };
    }

    if (typeof query === 'object' && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }

    return url.toString();
  }

  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  protected async prepareOptions(options: FinalRequestOptions): Promise<void> {
    if (this._provider) return;

    const security = options.__security ?? { bearerAuth: true };
    if (security.bearerAuth) {
      await this._callApiKey();
    }
  }

  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  protected async prepareRequest(
    request: RequestInit,
    { url, options }: { url: string; options: FinalRequestOptions },
  ): Promise<void> {}

  get<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp> {
    return this.methodRequest('get', path, opts);
  }

  post<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp> {
    return this.methodRequest('post', path, opts);
  }

  patch<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp> {
    return this.methodRequest('patch', path, opts);
  }

  put<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp> {
    return this.methodRequest('put', path, opts);
  }

  delete<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions>): APIPromise<Rsp> {
    return this.methodRequest('delete', path, opts);
  }

  private methodRequest<Rsp>(
    method: HTTPMethod,
    path: string,
    opts?: PromiseOrValue<RequestOptions>,
  ): APIPromise<Rsp> {
    return this.request(
      Promise.resolve(opts).then((opts) => {
        return { method, path, ...opts };
      }),
    );
  }

  request<Rsp>(
    options: PromiseOrValue<FinalRequestOptions>,
    remainingRetries: number | null = null,
  ): APIPromise<Rsp> {
    const authentication = this.#x509Authentication ?? this._workloadIdentityAuth;
    const request =
      authentication instanceof X509WorkloadIdentityAuth
        ? Promise.resolve(options).then((resolved) =>
            authentication.runRequest(() => this.makeRequest(resolved, remainingRetries, undefined), this),
          )
        : this.makeRequest(options, remainingRetries, undefined);
    return this.responsePromise<Rsp>(request);
  }

  private responsePromise<Rsp>(
    request: Promise<APIResponseProps>,
    parse: (client: OpenAI, props: APIResponseProps) => Promise<any> = (client, props) =>
      this.parseResponseWithTimeout<Rsp>(client, props),
  ): APIPromise<Rsp> {
    const promise = new APIPromise<Rsp>(this, request, (client, props) => {
      const resume = this.#responseAttempts.get(props.controller)?.continueRequest;
      return resume ? resume(() => parse(client, props)) : parse(client, props);
    });

    // A body timeout can retry after the original raw response has arrived. Wait for
    // parsing before selecting the response so withResponse() reports the retry.
    promise.withResponse = async () => {
      const data = await promise;
      const { response } = await request;
      return { data, response, request_id: response.headers.get('x-request-id') };
    };
    promise._thenUnwrap = <Next>(transform: (data: Rsp, props: APIResponseProps) => Next) =>
      this.responsePromise<Next>(request, async (client, props) =>
        addRequestID(transform(await parse(client, props), props), props.response),
      );

    return promise;
  }

  private async parseResponseWithTimeout<Rsp>(client: OpenAI, props: APIResponseProps): Promise<any> {
    if (
      props.options.stream ||
      props.options.__binaryResponse ||
      props.response.status === 204 ||
      props.response.headers.get('content-length') === '0'
    ) {
      const attempt = this.#responseAttempts.get(props.controller);
      if (attempt) delete attempt.workloadHeaders;
      return defaultParseResponse<Rsp>(client, props);
    }

    while (true) {
      const attempt = this.#responseAttempts.get(props.controller);
      const timeout = attempt?.timeout ?? props.options.timeout ?? this.timeout;
      const x509Authentication = attempt?.authentication;
      const callerSignal = x509Authentication ? props.controller.signal : props.options.signal;
      const abortError = () =>
        x509Authentication && callerSignal
          ? this._makeUserAbortError(callerSignal)
          : new Errors.APIUserAbortError();
      let remaining: number;
      try {
        remaining =
          x509Authentication?.remainingTimeout(props.options, timeout) ??
          Math.max(0, props.startTime + timeout - Date.now());
      } catch (error) {
        if (attempt) delete attempt.workloadHeaders;
        const cancellation = callerSignal?.aborted ? abortError() : undefined;
        props.controller.abort();
        void Shims.CancelReadableStream(props.response.body).catch(() => undefined);
        throw cancellation ?? error;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      let timedOut = false;

      try {
        // Tool runners preserve a completed buffered turn before cancellation stops the next request.
        if (callerSignal?.aborted && attempt?.helperMethod !== 'runTools') {
          throw abortError();
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            props.controller.abort();
            reject(new Errors.APIConnectionTimeoutError());
          }, remaining);

          if (callerSignal) {
            abortListener = () => {
              if (!timedOut) reject(abortError());
            };
            callerSignal.addEventListener('abort', abortListener, { once: true });
          }
        });

        return await Promise.race([defaultParseResponse<Rsp>(client, props), timeoutPromise]);
      } catch (error) {
        if (callerSignal?.aborted && !timedOut) {
          throw abortError();
        }
        if (!timedOut) {
          if (x509Authentication && error instanceof SyntaxError) {
            throw new SyntaxError('X.509 workload identity API response contains invalid JSON.');
          }
          if (x509Authentication && !(error instanceof Errors.OpenAIError)) {
            throw new Errors.APIConnectionError({
              message: 'X.509 workload identity API response body could not be read.',
            });
          }
          throw error;
        }

        const retriesRemaining = attempt?.retriesRemaining ?? 0;
        if (
          !retriesRemaining ||
          attempt?.hasStreamingBody ||
          props.options.__metadata?.['hasStreamingBody'] ||
          ((globalThis as any).ReadableStream &&
            props.options.body instanceof (globalThis as any).ReadableStream) ||
          (typeof props.options.body === 'object' &&
            props.options.body !== null &&
            (Symbol.asyncIterator in props.options.body ||
              (Symbol.iterator in props.options.body &&
                'next' in props.options.body &&
                typeof props.options.body.next === 'function')))
        ) {
          throw new Errors.APIConnectionTimeoutError();
        }

        if (timer !== undefined) clearTimeout(timer);
        if (abortListener) callerSignal?.removeEventListener('abort', abortListener);
        abortListener = undefined;

        const next = await this.retryRequest(
          props.options,
          retriesRemaining,
          props.retryOfRequestLogID ?? props.requestLogID,
          undefined,
          attempt?.workloadHeaders,
        );
        Object.assign(props, next);
      } finally {
        if (attempt) delete attempt.workloadHeaders;
        if (timer !== undefined) clearTimeout(timer);
        if (abortListener) callerSignal?.removeEventListener('abort', abortListener);
      }
    }
  }

  /** Keeps terminal X.509 error-body consumption inside the original logical request deadline. */
  private async readX509ResponseError(
    response: Response,
    options: FinalRequestOptions,
    timeout: number,
    controller: AbortController,
    authentication: X509WorkloadIdentityAuth,
  ): Promise<string> {
    const deadline = new AbortController();
    const callerSignal = controller.signal;
    let timedOut = false;
    const cancel = () => deadline.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', cancel, { once: true });
    if (callerSignal.aborted) {
      cancel();
    }

    try {
      const remaining = authentication.remainingTimeout(options, timeout);
      const expiration = authentication.waitForRetry(remaining, deadline.signal).then(() => {
        throw new Errors.APIConnectionTimeoutError();
      });
      const body = await Promise.race([
        response.text().catch(() => 'X.509 workload identity API response body could not be read.'),
        expiration,
      ]);
      if (callerSignal.aborted) {
        throw this._makeUserAbortError(callerSignal);
      }
      return body;
    } catch (error) {
      if (error instanceof Errors.APIConnectionTimeoutError) {
        timedOut = !callerSignal.aborted;
        controller.abort();
        void Shims.CancelReadableStream(response.body).catch(() => undefined);
      }
      if (callerSignal.aborted && !timedOut) {
        throw this._makeUserAbortError(callerSignal);
      }
      throw error;
    } finally {
      callerSignal.removeEventListener('abort', cancel);
      deadline.abort();
    }
  }

  private async makeRequest(
    optionsInput: PromiseOrValue<FinalRequestOptions>,
    retriesRemaining: number | null,
    retryOfRequestLogID: string | undefined,
    workloadHeaders?: WorkloadHeaderSnapshots,
  ): Promise<APIResponseProps> {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }

    const x509Authentication = this.#x509Authentication;
    x509Authentication?.beginRequestPreparation();
    const preparation = captureHeaderReads(() => this.prepareOptions(options));
    await preparation.result;
    const previousBuildInput = workloadHeaders?.customBuildInput;
    const usesCustomWorkloadBuildRequest =
      this._workloadIdentityAuth instanceof WorkloadIdentityAuth &&
      this.buildRequest !== OpenAI.prototype.buildRequest;
    // Read ordinary data properties without invoking a lazy accessor before the custom hook.
    let buildInputDescriptor: PropertyDescriptor | undefined;
    if (usesCustomWorkloadBuildRequest) {
      const seen = new Set<object>();
      try {
        for (let source: object | null = options; source && !buildInputDescriptor;) {
          if (seen.has(source)) break;
          seen.add(source);
          buildInputDescriptor = Object.getOwnPropertyDescriptor(source, 'headers');
          source = Object.getPrototypeOf(source);
        }
      } catch {
        // Uninspectable lazy options are read only after the custom hook runs.
      }
    }
    const hasBuildInputValue = !!buildInputDescriptor && 'value' in buildInputDescriptor;
    let buildInputHeaders = hasBuildInputValue
      ? (buildInputDescriptor!.value as HeadersLike)
      : previousBuildInput?.source;
    let buildInputDefaults = usesCustomWorkloadBuildRequest
      ? this._options.defaultHeaders
      : previousBuildInput?.defaultSource;
    let needsBuildRetryGuard =
      previousBuildInput &&
      ((hasBuildInputValue &&
        previousBuildInput.source === buildInputHeaders &&
        (!previousBuildInput.replayable || !canReplayHeaderInput(previousBuildInput.source))) ||
        (previousBuildInput.defaultSource === this._options.defaultHeaders &&
          (!previousBuildInput.defaultReplayable ||
            !canReplayHeaderInput(previousBuildInput.defaultSource))));
    if (needsBuildRetryGuard && !previousBuildInput?.owned) {
      throw new Errors.OpenAIError(
        'A custom buildRequest hook must retain original options or forward credentialContext before retrying a one-shot source.',
      );
    }
    if (previousBuildInput) {
      previousBuildInput.preventCredentialUpgrade =
        (!previousBuildInput.replayable || !previousBuildInput.defaultReplayable || !!needsBuildRetryGuard) &&
        previousBuildInput.independentAuthorization;
    }
    let buildInputReplayable = usesCustomWorkloadBuildRequest
      ? canReplayHeaderInput(buildInputHeaders)
      : true;
    let buildDefaultReplayable = usesCustomWorkloadBuildRequest
      ? canReplayHeaderInput(buildInputDefaults)
      : true;
    const credentialContext = {};
    if (this.buildRequest === OpenAI.prototype.buildRequest && workloadHeaders?.defaultHeaders.initialized) {
      workloadHeaders.defaultHeaders.refresh(this._options.defaultHeaders);
    }
    if (this.buildRequest === OpenAI.prototype.buildRequest && workloadHeaders?.requestHeaders.initialized) {
      workloadHeaders.requestHeaders.refresh(options.headers);
    }
    if (
      this._workloadIdentityAuth instanceof WorkloadIdentityAuth &&
      this.buildRequest === OpenAI.prototype.buildRequest
    ) {
      // Caller preparation owns its input; SDK snapshots remain private to this request and its retries.
      workloadHeaders ??= createWorkloadHeaderSnapshots(options.headers, this._options.defaultHeaders, {
        captured: preparation.captured,
        deferRequest: !this.#canPreflightWorkloadIdentityHeaders(options) && !('body' in options),
        deferDefault: !this.#canPreflightWorkloadIdentityHeaders(options),
      });
    }
    const workloadIdentityAuthScope =
      this._workloadIdentityAuth instanceof WorkloadIdentityAuth
        ? this.#workloadTokenProvenance.begin(options, credentialContext, workloadHeaders)
        : undefined;

    x509Authentication?.beginRequestPlanning();
    let built: { req: FinalizedRequestInit; url: string; timeout: number };
    let initialWorkloadAuthorization: string | undefined;
    let workloadCredential: WorkloadCredentialUsage | undefined;
    try {
      let candidate: Awaited<ReturnType<OpenAI['buildRequest']>>;
      try {
        candidate = await this.buildRequest(options, {
          retryCount: maxRetries - retriesRemaining,
          credentialContext,
        });
        const ownedBuild = this.#workloadTokenProvenance.ownsResult(candidate, credentialContext);
        workloadHeaders =
          this.#workloadTokenProvenance.takeHeaders(candidate) ??
          workloadIdentityAuthScope?.headers ??
          workloadHeaders;
        if (usesCustomWorkloadBuildRequest) {
          if (!hasBuildInputValue || (!previousBuildInput && buildInputHeaders === undefined)) {
            buildInputHeaders = workloadHeaders?.requestHeaders.source;
            buildInputReplayable = canReplayHeaderInput(buildInputHeaders);
          }
          if (buildInputDefaults === undefined) {
            buildInputDefaults = workloadHeaders?.defaultHeaders.source ?? this._options.defaultHeaders;
            buildDefaultReplayable = canReplayHeaderInput(buildInputDefaults);
          }
        }
        needsBuildRetryGuard ||=
          !!previousBuildInput &&
          ((previousBuildInput.source === buildInputHeaders &&
            (!previousBuildInput.replayable || !canReplayHeaderInput(previousBuildInput.source))) ||
            (previousBuildInput.defaultSource === buildInputDefaults &&
              (!previousBuildInput.defaultReplayable ||
                !canReplayHeaderInput(previousBuildInput.defaultSource))));
        if (
          !workloadHeaders &&
          this._workloadIdentityAuth instanceof WorkloadIdentityAuth &&
          this.buildRequest !== OpenAI.prototype.buildRequest
        ) {
          // A legacy hook may delegate without credentialContext and then reconstruct the returned request,
          // dropping both paths that carry parsed snapshots. Retain a deferred outer guard without reading
          // the hook's one-shot input a second time.
          workloadHeaders = createWorkloadHeaderSnapshots(buildInputHeaders, buildInputDefaults, {
            deferRequest: true,
            deferDefault: true,
          });
          workloadIdentityAuthScope?.captureHeaders(workloadHeaders);
        }
        if (needsBuildRetryGuard && !ownedBuild) {
          throw new Errors.OpenAIError(
            'A custom buildRequest hook must retain original options or forward credentialContext on every retry of a one-shot source.',
          );
        }
        if (workloadHeaders && this.buildRequest !== OpenAI.prototype.buildRequest) {
          workloadHeaders.customBuildInput = {
            source: buildInputHeaders,
            defaultSource: buildInputDefaults,
            replayable: buildInputReplayable,
            defaultReplayable: buildDefaultReplayable,
            owned: ownedBuild,
            independentAuthorization:
              workloadHeaders.defaultHeaders.initialized &&
              workloadHeaders.requestHeaders.initialized &&
              suppliesWorkloadAuthorization(
                buildHeaders([
                  workloadHeaders.defaultHeaders.snapshot,
                  workloadHeaders.requestHeaders.snapshot,
                ]),
              ),
            preventCredentialUpgrade: false,
          };
        }
        if (workloadIdentityAuthScope && !canPreserveHeaderInput(candidate.req.headers)) {
          candidate = {
            ...candidate,
            req: { ...candidate.req, headers: buildHeaders([candidate.req.headers]).values },
          };
        }
        const platformHeader = getPlatformHeader(candidate.req.headers, 'Authorization');
        const authorization =
          platformHeader === undefined ? candidate.req.headers.get('Authorization') : platformHeader.value;
        if (authorization !== null && this.#workloadTokenProvenance.matchesResult(candidate, authorization)) {
          initialWorkloadAuthorization = authorization;
          workloadCredential = this.#workloadTokenProvenance.retainResultCredential(candidate, authorization);
        }
      } finally {
        workloadIdentityAuthScope?.dispose();
      }
      built = { req: candidate.req, url: candidate.url, timeout: candidate.timeout };
      if (x509Authentication) {
        validatePositiveInteger('timeout', built.timeout);
        x509Authentication.authorizePlannedRequest(built.url, built.req, built.timeout);
        if (X509WorkloadIdentityAuth.isStreamingRequestBody(built.req.body)) {
          options.__metadata = { ...options.__metadata, hasStreamingBody: true };
        }
        await this.prepareRequest(built.req, { url: built.url, options });
        await this._provider?.prepareRequest?.(built.req, { url: built.url, options });
        x509Authentication.beginRequestPlanning();
        x509Authentication.authorizePlannedRequest(built.url, built.req, built.timeout, true);
        if (X509WorkloadIdentityAuth.isStreamingRequestBody(built.req.body)) {
          options.__metadata = { ...options.__metadata, hasStreamingBody: true };
        }
        const callerSignal = x509Authentication.requestSnapshot().signal;
        if (callerSignal?.aborted || built.req.signal?.aborted) {
          throw this._makeUserAbortError(callerSignal?.aborted ? callerSignal : built.req.signal!);
        }
        x509Authentication.setEffectiveSignal(
          built.req.signal || callerSignal
            ? createRequestController(built.req.signal ?? callerSignal, callerSignal).signal
            : undefined,
        );
        x509Authentication.beginRequestNetwork();
        const security = options.__security ?? { bearerAuth: true };
        const authenticationHeaders = await this.authHeaders(options, security);
        const suppliedHeaders = x509Authentication.headerSnapshots();
        const supplied = buildHeaders([suppliedHeaders.defaultHeaders, suppliedHeaders.requestHeaders]);
        for (const [name, value] of authenticationHeaders?.values ?? []) {
          if (!supplied.nulls.has(name) && !built.req.headers.has(name)) {
            built.req.headers.set(name, value);
          }
        }
        this.validateHeaders(buildHeaders([supplied, built.req.headers]), security);
      }
    } catch (error) {
      x509Authentication?.retireRequestBody();
      if (
        x509Authentication &&
        retriesRemaining &&
        !options.__metadata?.['hasStreamingBody'] &&
        X509WorkloadIdentityAuth.isRetryableFailure(error)
      ) {
        return await this.retryRequest(
          options,
          retriesRemaining,
          retryOfRequestLogID ?? 'x509-token-exchange',
          X509WorkloadIdentityAuth.retryHeaders(error),
        );
      }
      throw error;
    }
    const { req, url } = built;
    const timeout = x509Authentication
      ? Math.min(built.timeout, x509Authentication.requestSnapshot().timeout)
      : built.timeout;
    x509Authentication?.bindRequest(options, req, this.adminAPIKey);
    let hasStreamingBody = options.__metadata?.['hasStreamingBody'] === true;

    if (!x509Authentication) {
      await this.prepareRequest(req, { url, options });
      this.#observeWorkloadHeaderReplacement(workloadCredential, req, initialWorkloadAuthorization);
      await this._provider?.prepareRequest?.(req, { url, options });
      this.#observeWorkloadHeaderReplacement(workloadCredential, req, initialWorkloadAuthorization);
    }
    x509Authentication?.adoptRequestHeaders(req);
    if (x509Authentication && X509WorkloadIdentityAuth.isStreamingRequestBody(req.body)) {
      hasStreamingBody = true;
    }

    /** Not an API request ID, just for correlating local log entries. */
    const requestLogID = 'log_' + ((Math.random() * (1 << 24)) | 0).toString(16).padStart(6, '0');
    const retryLogStr = retryOfRequestLogID === undefined ? '' : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = x509Authentication?.requestStartedAt(options) ?? Date.now();

    loggerFor(this).debug(
      `[${requestLogID}] sending request`,
      formatRequestDetails({
        retryOfRequestLogID,
        method: options.method,
        url,
        options: x509Authentication ? { body: req.body, ...x509Authentication.requestSnapshot() } : options,
        headers: req.headers,
      }),
    );

    const callerSignal = x509Authentication ? x509Authentication.requestSnapshot().signal : options.signal;
    if (callerSignal?.aborted || req.signal?.aborted) {
      throw this._makeUserAbortError(callerSignal?.aborted ? callerSignal : req.signal!);
    }
    const security = options.__security ?? { bearerAuth: true };
    // Request hooks may replace the caller signal before it reaches fetch.
    const controller =
      x509Authentication || this.fetchWithTimeout === OpenAI.prototype.fetchWithTimeout
        ? createRequestController(
            req.signal ?? (x509Authentication ? callerSignal : undefined),
            x509Authentication ? callerSignal : undefined,
          )
        : new AbortController();
    const remainingTimeout = x509Authentication?.remainingTimeout(options, timeout) ?? timeout;
    const fetchWithAuth = x509Authentication ? OpenAI.prototype.fetchWithAuth : this.fetchWithAuth;
    x509Authentication?.releaseRequestBody(req.body);
    const workloadRequest = {
      context: credentialContext,
      bindings: new Set<object>(),
      authorization: initialWorkloadAuthorization,
      credential: workloadCredential,
      responses: new WeakMap<Response, boolean>(),
      responseBodies: new WeakMap<object, boolean>(),
      cloneTrackedResponses: new Set<Response>(),
      finished: false,
    };
    if (this._workloadIdentityAuth && !x509Authentication) {
      this.#bindWorkloadIdentityRequest(controller, workloadRequest);
      this.#bindWorkloadIdentityRequest(req, workloadRequest);
      this.#bindWorkloadIdentityRequest(credentialContext, workloadRequest);
      const carrier = this.#workloadTokenProvenance.requestCarrier(req);
      if (carrier) this.#bindWorkloadIdentityRequest(carrier, workloadRequest);
    }
    const response = await fetchWithAuth
      .call(this, url, req, remainingTimeout, controller, security, credentialContext)
      .catch(castToError)
      .finally(() => {
        for (const key of workloadRequest.bindings) {
          const requests = this.#workloadIdentityRequests.get(key);
          requests?.delete(workloadRequest);
          if (requests?.size === 0) this.#workloadIdentityRequests.delete(key);
        }
        workloadRequest.bindings.clear();
        workloadRequest.finished = true;
        releaseWorkloadIdentityResponseClones(workloadRequest);
      });
    const usedWorkloadToken =
      !(response instanceof globalThis.Error) && responseUsedWorkloadToken(workloadRequest, response);
    const headersTime = Date.now();

    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (callerSignal?.aborted || req.signal?.aborted) {
        throw this._makeUserAbortError(callerSignal?.aborted ? callerSignal : req.signal!);
      }
      // detect native connection timeout errors
      // deno throws "TypeError: error sending request for url (https://example/): client error (Connect): tcp connect error: Operation timed out (os error 60): Operation timed out (os error 60)"
      // undici throws "TypeError: fetch failed" with cause "ConnectTimeoutError: Connect Timeout Error (attempted address: example:443, timeout: 1ms)"
      // others do not provide enough information to distinguish timeouts from other connection errors
      const isTimeout =
        isAbortError(response) ||
        /timed? ?out/i.test(String(response) + ('cause' in response ? String(response.cause) : ''));
      if (
        retriesRemaining &&
        !hasStreamingBody &&
        (!x509Authentication || isTransientX509ConnectionError(response))
      ) {
        loggerFor(this).info(
          `[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} - ${retryMessage}`,
        );
        loggerFor(this).debug(
          `[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} (${retryMessage})`,
          formatRequestDetails({
            retryOfRequestLogID,
            url,
            durationMs: headersTime - startTime,
            message: x509Authentication ? 'X.509 workload identity API connection failed.' : response.message,
          }),
        );
        return this.retryRequest(
          options,
          retriesRemaining,
          retryOfRequestLogID ?? requestLogID,
          undefined,
          workloadHeaders,
        );
      }
      const terminalMessage = hasStreamingBody
        ? 'error; streaming body cannot be retried'
        : 'error; no more retries left';
      loggerFor(this).info(
        `[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} - ${terminalMessage}`,
      );
      loggerFor(this).debug(
        `[${requestLogID}] connection ${isTimeout ? 'timed out' : 'failed'} (${terminalMessage})`,
        formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: x509Authentication ? 'X.509 workload identity API connection failed.' : response.message,
        }),
      );
      if (response instanceof OAuthError || response instanceof SubjectTokenProviderError) {
        throw response;
      }
      if (isTimeout) {
        const transportCause = 'cause' in response ? response.cause : undefined;
        const isHeadersTimeout =
          typeof transportCause === 'object' &&
          transportCause !== null &&
          'code' in transportCause &&
          transportCause.code === 'UND_ERR_HEADERS_TIMEOUT';
        const timeoutError = isHeadersTimeout
          ? new Errors.APIConnectionTimeoutError({
              message:
                'Request timed out. Node.js fetch timed out waiting for response headers; ' +
                'configure a matching undici fetch and fetchOptions.dispatcher with an Agent whose headersTimeout is at least the SDK timeout.',
            })
          : new Errors.APIConnectionTimeoutError();
        if (x509Authentication) {
          throw new Errors.APIConnectionTimeoutError();
        }
        throw Object.assign(timeoutError, { cause: response });
      }
      if (x509Authentication) {
        throw new Errors.APIConnectionError({ message: 'X.509 workload identity API connection failed.' });
      }
      throw new Errors.APIConnectionError({
        message: getConnectionErrorMessage(response),
        cause: response,
      });
    }

    const specialHeaders = [...response.headers.entries()]
      .filter(([name]) => name === 'x-request-id')
      .map(([name, value]) => ', ' + name + ': ' + JSON.stringify(value))
      .join('');
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${redactURL(url)} ${
      response.ok ? 'succeeded' : 'failed'
    } with status ${response.status} in ${headersTime - startTime}ms`;

    if (!response.ok) {
      const rejectedX509Credential =
        response.status === 401 &&
        x509Authentication &&
        security.bearerAuth &&
        x509Authentication.usedWorkloadToken(options);
      if (rejectedX509Credential) {
        x509Authentication.invalidateToken();
      }
      if (
        response.status === 401 &&
        (x509Authentication || this._workloadIdentityAuth) &&
        security.bearerAuth &&
        (x509Authentication ? x509Authentication.usedWorkloadToken(options) : usedWorkloadToken) &&
        (!x509Authentication || retriesRemaining > 0) &&
        !hasStreamingBody &&
        !options.__metadata?.['workloadIdentityTokenRefreshed']
      ) {
        if (x509Authentication) {
          void Shims.CancelReadableStream(response.body).catch(() => undefined);
        } else {
          await Shims.CancelReadableStream(response.body);
          this._workloadIdentityAuth?.invalidateToken();
        }

        const replayOptions = {
          ...options,
          __metadata: {
            ...options.__metadata,
            workloadIdentityTokenRefreshed: true,
          },
        };
        return this.makeRequest(
          replayOptions,
          x509Authentication ? retriesRemaining - 1 : retriesRemaining,
          retryOfRequestLogID ?? requestLogID,
          workloadHeaders,
        );
      }

      const shouldRetry =
        rejectedX509Credential && options.__metadata?.['workloadIdentityTokenRefreshed']
          ? false
          : await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry && !hasStreamingBody) {
        const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;

        // We don't need the body of this response.
        if (x509Authentication) {
          void Shims.CancelReadableStream(response.body).catch(() => undefined);
        } else {
          await Shims.CancelReadableStream(response.body);
        }
        loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
        loggerFor(this).debug(
          `[${requestLogID}] response error (${retryMessage})`,
          formatRequestDetails({
            retryOfRequestLogID,
            url: response.url,
            status: response.status,
            headers: response.headers,
            durationMs: headersTime - startTime,
          }),
        );
        return this.retryRequest(
          options,
          retriesRemaining,
          retryOfRequestLogID ?? requestLogID,
          response.headers,
          workloadHeaders,
        );
      }

      const retryMessage = shouldRetry
        ? hasStreamingBody
          ? `error; streaming body cannot be retried`
          : `error; no more retries left`
        : `error; not retryable`;

      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);

      const errText = x509Authentication
        ? await this.readX509ResponseError(response, options, timeout, controller, x509Authentication)
        : await response.text().catch((err: any) => castToError(err).message);
      const errJSON = safeJSON(errText) as any;
      const errMessage = errJSON ? undefined : errText;

      loggerFor(this).debug(
        `[${requestLogID}] response error (${retryMessage})`,
        formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          message: errMessage,
          durationMs: Date.now() - startTime,
        }),
      );

      const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
      throw err;
    }

    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(
      `[${requestLogID}] response start`,
      formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        durationMs: headersTime - startTime,
      }),
    );

    const continueRequest = x509Authentication?.continuation();
    x509Authentication?.releaseRequestCredentials();
    this.#responseAttempts.set(controller, {
      timeout,
      retriesRemaining,
      hasStreamingBody,
      ...(workloadHeaders ? { workloadHeaders } : {}),
      ...(x509Authentication ? { authentication: x509Authentication } : {}),
      helperMethod: options.__metadata?.['helperMethod'],
      ...(continueRequest ? { continueRequest } : {}),
    });
    return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
  }

  getAPIList<Item, PageClass extends Pagination.AbstractPage<Item> = Pagination.AbstractPage<Item>>(
    path: string,
    Page: new (...args: any[]) => PageClass,
    opts?: PromiseOrValue<RequestOptions>,
  ): Pagination.PagePromise<PageClass, Item> {
    return this.requestAPIList(
      Page,
      opts && 'then' in opts
        ? opts.then((opts) => ({ method: 'get', path, ...opts }))
        : { method: 'get', path, ...opts },
    );
  }

  requestAPIList<
    Item = unknown,
    PageClass extends Pagination.AbstractPage<Item> = Pagination.AbstractPage<Item>,
  >(
    Page: new (...args: ConstructorParameters<typeof Pagination.AbstractPage>) => PageClass,
    options: PromiseOrValue<FinalRequestOptions>,
  ): Pagination.PagePromise<PageClass, Item> {
    const authentication = this.#x509Authentication ?? this._workloadIdentityAuth;
    const request =
      authentication instanceof X509WorkloadIdentityAuth
        ? Promise.resolve(options).then((resolved) =>
            authentication.runRequest(() => this.makeRequest(resolved, null, undefined), this),
          )
        : this.makeRequest(options, null, undefined);
    const page = new Pagination.PagePromise<PageClass, Item>(this as any as OpenAI, request, Page);
    const guarded = this.responsePromise<PageClass>(request, async (client, props) => {
      const body = await this.parseResponseWithTimeout(client, props);
      return new Page(client, props.response, body, props.options);
    });
    page.then = guarded.then.bind(guarded);
    page.catch = guarded.catch.bind(guarded);
    page.finally = guarded.finally.bind(guarded);
    page.withResponse = guarded.withResponse.bind(guarded);
    page._thenUnwrap = guarded._thenUnwrap.bind(guarded);
    return page;
  }

  protected async fetchWithAuth(
    url: RequestInfo,
    init: RequestInit,
    timeout: number,
    controller: AbortController,
    schemes: { bearerAuth?: boolean; adminAPIKeyAuth?: boolean } = {
      bearerAuth: true,
      adminAPIKeyAuth: true,
    },
    credentialContext?: object,
  ): Promise<Response> {
    const workloadRequest = this.#workloadIdentityRequest(controller, init, credentialContext);
    if (workloadRequest) {
      this.#observeWorkloadHeaderReplacement(workloadRequest.credential, init, workloadRequest.authorization);
      this.#bindWorkloadIdentityRequest(controller, workloadRequest);
      this.#bindWorkloadIdentityRequest(init, workloadRequest);
    }
    if (this._workloadIdentityAuth && !this.#x509Fetch && schemes.bearerAuth) {
      const platformHeader =
        init.headers && hasNativeHeadersBrand(init.headers)
          ? getPlatformHeader(init.headers, 'Authorization')
          : undefined;
      const replayable = platformHeader !== undefined || canPreserveHeaderInput(init.headers);
      const headers = platformHeader ? undefined : new Headers(init.headers);
      if (headers && !replayable) init = { ...init, headers };
      const authHeader = platformHeader ? platformHeader.value : headers?.get('Authorization');
      if (authHeader === `Bearer ${WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER}`) {
        const token = await this._workloadIdentityAuth.getToken();
        const authenticatedHeaders = headers ?? new Headers(init.headers);
        authenticatedHeaders.set('Authorization', `Bearer ${token}`);
        init = { ...init, headers: authenticatedHeaders };
        const credential = this.#workloadTokenProvenance.issue({ values: authenticatedHeaders }, token);
        if (workloadRequest) {
          workloadRequest.authorization = `Bearer ${token}`;
          workloadRequest.credential = credential;
        }
      }
    }

    const fetchWithTimeout = this.#x509Fetch ? OpenAI.prototype.fetchWithTimeout : this.fetchWithTimeout;
    const response = await fetchWithTimeout.call(
      this,
      url,
      init,
      timeout,
      controller,
      workloadRequest?.context,
    );

    return response;
  }

  async fetchWithTimeout(
    url: RequestInfo,
    init: RequestInit | undefined,
    ms: number,
    controller: AbortController,
    credentialContext?: object,
  ): Promise<Response> {
    const workloadRequest = this.#workloadIdentityRequest(controller, init, credentialContext);
    const { signal, method, ...options } = init || {};
    const abort = this._makeAbort(controller);
    const composed = !!signal && composedCallerSignals.get(controller) === signal;
    if (signal && !composed) signal.addEventListener('abort', abort, { once: true });

    const timeout = setTimeout(abort, ms);

    const isReadableBody =
      ((globalThis as any).ReadableStream && options.body instanceof (globalThis as any).ReadableStream) ||
      (typeof options.body === 'object' && options.body !== null && Symbol.asyncIterator in options.body);

    const fetchOptions: RequestInit = {
      signal: controller.signal as any,
      ...(isReadableBody ? { duplex: 'half' } : {}),
      method: 'GET',
      ...options,
    };
    if (method) {
      // Custom methods like 'patch' need to be uppercased
      // See https://github.com/nodejs/undici/issues/2294
      fetchOptions.method = method.toUpperCase();
    }

    try {
      // Only this dispatch owner can attest to the headers passed to the configured fetch.
      // Hooks that send independently own their authentication retries.
      const { init: dispatchOptions, used } = this.#snapshotWorkloadIdentityUsage(
        workloadRequest,
        url,
        fetchOptions,
      );
      // use undefined this binding; fetch errors if bound to something else in browser/cloudflare
      const response = await (this.#x509Fetch ?? this.fetch).call(
        undefined,
        url,
        WorkloadTokenProvenance.forDispatch(dispatchOptions),
      );
      if (workloadRequest) {
        recordWorkloadIdentityResponse(workloadRequest, response, used);
      }
      return response;
    } catch (err) {
      if (signal && !composed) signal.removeEventListener('abort', abort);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async shouldRetry(response: Response): Promise<boolean> {
    // Note this is not a standard header.
    const shouldRetryHeader = response.headers.get('x-should-retry');

    // If the server explicitly says whether or not to retry, obey.
    if (shouldRetryHeader === 'true') return true;
    if (shouldRetryHeader === 'false') return false;

    // Retry on request timeouts.
    if (response.status === 408) return true;

    // Retry on lock timeouts.
    if (response.status === 409) return true;

    // Retry on rate limits.
    if (response.status === 429) return true;

    // Retry internal errors.
    if (response.status >= 500) return true;

    return false;
  }

  private async retryRequest(
    options: FinalRequestOptions,
    retriesRemaining: number,
    requestLogID: string,
    responseHeaders?: Headers | undefined,
    workloadHeaders?: WorkloadHeaderSnapshots,
  ): Promise<APIResponseProps> {
    let timeoutMillis: number | undefined;

    // Note the `retry-after-ms` header may not be standard, but is a good idea and we'd like proactive support for it.
    const retryAfterMillisHeader = responseHeaders?.get('retry-after-ms');
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }

    // About the Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
    const retryAfterHeader = responseHeaders?.get('retry-after');
    if (retryAfterHeader && timeoutMillis === undefined) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1000;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }

    // If the API asks us to wait a certain amount of time, just do what it
    // says, but otherwise calculate a default
    if (
      timeoutMillis === undefined ||
      !Number.isFinite(timeoutMillis) ||
      timeoutMillis < 0 ||
      timeoutMillis > 60 * 1000
    ) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    const x509Authentication = this.#x509Authentication;
    if (x509Authentication) {
      const remaining = x509Authentication.remainingTimeout(
        options,
        x509Authentication.requestSnapshot().timeout,
      );
      if (timeoutMillis >= remaining) {
        throw new Errors.APIConnectionTimeoutError();
      }
    }
    if (x509Authentication) {
      await x509Authentication.waitForRetry(timeoutMillis, x509Authentication.effectiveSignal());
    } else {
      await sleep(timeoutMillis);
    }

    return this.makeRequest(options, retriesRemaining - 1, requestLogID, workloadHeaders);
  }

  private calculateDefaultRetryTimeoutMillis(retriesRemaining: number, maxRetries: number): number {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8.0;

    const numRetries = maxRetries - retriesRemaining;

    // Apply exponential backoff, but not more than the max.
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);

    // Apply some jitter, take up to at most 25 percent of the retry time.
    const jitter = 1 - Math.random() * 0.25;

    return sleepSeconds * jitter * 1000;
  }

  async buildRequest(
    inputOptions: FinalRequestOptions,
    { retryCount = 0, credentialContext }: { retryCount?: number; credentialContext?: object } = {},
  ): Promise<{ req: FinalizedRequestInit; url: string; timeout: number }> {
    if (this.#x509Authentication && !this.#x509Authentication.inRequest(this)) {
      const authentication = this.#x509Authentication;
      return await authentication.runRequest(async () => {
        const built = await OpenAI.prototype.buildRequest.call(this, inputOptions, { retryCount });
        authentication.releaseRequestBody(built.req.body);
        return built;
      }, this);
    }
    if (
      this._workloadIdentityAuth instanceof WorkloadIdentityAuth &&
      !this.#workloadTokenProvenance.scopeFor(inputOptions, credentialContext)
    ) {
      if (
        this.#workloadTokenProvenance.hasConsumedHeaders(inputOptions.headers, this._options.defaultHeaders)
      ) {
        throw new Errors.OpenAIError(
          'A buildRequest override copying consumed one-shot headers must forward credentialContext.',
        );
      }
      // Standalone builds own their header replay until every authentication hook returns.
      const context = {};
      const headers = createWorkloadHeaderSnapshots(inputOptions.headers, this._options.defaultHeaders, {
        deferRequest: !this.#canPreflightWorkloadIdentityHeaders(inputOptions) && !('body' in inputOptions),
        deferDefault: !this.#canPreflightWorkloadIdentityHeaders(inputOptions),
      });
      const scope = this.#workloadTokenProvenance.begin(inputOptions, context, headers);
      try {
        return await OpenAI.prototype.buildRequest.call(this, inputOptions, {
          retryCount,
          credentialContext: context,
        });
      } finally {
        scope.dispose();
      }
    }
    const workloadScope = this.#workloadTokenProvenance.scopeFor(inputOptions, credentialContext);
    const priorHeaders = workloadScope?.headers;
    if (priorHeaders?.customBuildInput) {
      if (priorHeaders.defaultHeaders.initialized) {
        priorHeaders.defaultHeaders.refresh(this._options.defaultHeaders);
      }
      if (priorHeaders.requestHeaders.initialized) {
        priorHeaders.requestHeaders.refresh(inputOptions.headers);
      }
      if (
        priorHeaders.customBuildInput.preventCredentialUpgrade &&
        !suppliesWorkloadAuthorization(
          buildHeaders([priorHeaders.defaultHeaders.snapshot, priorHeaders.requestHeaders.snapshot]),
        )
      ) {
        throw new Errors.OpenAIError(
          'A custom buildRequest hook must retain parsed headers before retrying a one-shot source.',
        );
      }
      workloadScope?.captureHeaders(priorHeaders);
    }
    if (workloadScope && !workloadScope.headers) {
      workloadScope.captureHeaders(
        createWorkloadHeaderSnapshots(inputOptions.headers, this._options.defaultHeaders, {
          deferRequest: !this.#canPreflightWorkloadIdentityHeaders(inputOptions) && !('body' in inputOptions),
          deferDefault: !this.#canPreflightWorkloadIdentityHeaders(inputOptions),
        }),
      );
    }
    const options = { ...inputOptions };
    const x509Authentication = this.#x509Authentication;
    const x509Tenant = x509Authentication?.snapshotTenant(this.organization, this.project);
    const x509Headers = x509Authentication?.snapshotHeaders(this._options.defaultHeaders, options.headers);
    if (x509Headers) {
      options.headers = x509Headers.requestHeaders;
    }
    const x509ClientFetchOptions = x509Authentication
      ? snapshotX509RequestOptions(this.fetchOptions)
      : undefined;
    const x509RequestFetchOptions = x509Authentication
      ? snapshotX509RequestOptions(options.fetchOptions)
      : undefined;
    const { method, path, query, defaultBaseURL } = options;

    const url = this.buildURL(path!, query as Record<string, unknown>, defaultBaseURL);
    x509Authentication?.snapshotAPIURL(url);
    const explicitTimeout = 'timeout' in options;
    if (explicitTimeout) validatePositiveInteger('timeout', options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    if (x509Authentication && x509RequestFetchOptions) {
      x509Authentication.snapshotRequest(options.signal, options.timeout, x509RequestFetchOptions);
    }
    if (x509Authentication) {
      const snapshot = x509Authentication.requestSnapshot();
      options.timeout = snapshot.timeout;
      if (snapshot.signal === undefined) {
        delete options.signal;
      } else {
        options.signal = snapshot.signal;
      }
    }
    const requestHeaderSnapshot =
      this._workloadIdentityAuth && !x509Authentication
        ? (this.#workloadTokenProvenance.scopeFor(inputOptions, credentialContext)?.headers?.requestHeaders ??
          snapshotHeaders(options.headers))
        : undefined;
    if (requestHeaderSnapshot && (requestHeaderSnapshot.initialized || 'body' in options)) {
      options.headers =
        requestHeaderSnapshot.source === inputOptions.headers
          ? requestHeaderSnapshot.snapshot
          : requestHeaderSnapshot.refresh(inputOptions.headers);
    }
    const { bodyHeaders, body, isStreamingBody } = this.buildBody({ options });

    if (isStreamingBody) {
      inputOptions.__metadata = {
        ...inputOptions.__metadata,
        hasStreamingBody: true,
      };
      x509Authentication?.ownRequestBody(body, options.body);
    }

    const reqHeaders = await this.buildHeaders({
      options: inputOptions,
      credentialContext,
      method,
      bodyHeaders,
      requestHeaderSnapshot,
      retryCount,
      x509Headers,
      x509Timeout: explicitTimeout ? options.timeout : undefined,
      x509Tenant,
    });

    const req: FinalizedRequestInit = {
      method,
      headers: reqHeaders,
      ...(options.signal && { signal: options.signal }),
      ...((globalThis as any).ReadableStream &&
        body instanceof (globalThis as any).ReadableStream && { duplex: 'half' }),
      ...(body && { body }),
      ...(((x509Authentication ? x509ClientFetchOptions : this.fetchOptions) as any) ?? {}),
      ...(((x509Authentication ? x509RequestFetchOptions : options.fetchOptions) as any) ?? {}),
    };

    const result = { req, url, timeout: options.timeout };
    return this._workloadIdentityAuth && !x509Authentication
      ? this.#workloadTokenProvenance.bindResult(result, workloadScope?.headers, workloadScope?.context)
      : result;
  }

  #canPreflightWorkloadIdentityHeaders(options: FinalRequestOptions) {
    const security = options.__security ?? { bearerAuth: true };
    return (
      this._workloadIdentityAuth &&
      !this.#x509Authentication &&
      security.bearerAuth &&
      this.authHeaders === OpenAI.prototype.authHeaders &&
      this.bearerAuth === OpenAI.prototype.bearerAuth &&
      (!security.adminAPIKeyAuth || this.adminAPIKeyAuth === OpenAI.prototype.adminAPIKeyAuth)
    );
  }

  private async buildHeaders({
    options,
    credentialContext,
    method,
    bodyHeaders,
    requestHeaderSnapshot,
    retryCount,
    x509Headers,
    x509Timeout,
    x509Tenant,
  }: {
    options: FinalRequestOptions;
    credentialContext: object | undefined;
    method: HTTPMethod;
    bodyHeaders: HeadersLike;
    requestHeaderSnapshot: ReturnType<typeof snapshotHeaders> | undefined;
    retryCount: number;
    x509Headers?: { defaultHeaders: NullableHeaders; requestHeaders: NullableHeaders } | undefined;
    x509Timeout: number | undefined;
    x509Tenant?: { organization: string | null; project: string | null } | undefined;
  }): Promise<Headers> {
    let idempotencyHeaders: HeadersLike = {};
    if (this.idempotencyHeader && method !== 'get') {
      if (!options.idempotencyKey) options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }

    const helperMethod = options.__metadata?.['helperMethod'];
    const timeout = x509Headers ? x509Timeout : options.timeout;
    const security = options.__security ?? { bearerAuth: true };
    let authenticationSecurity = security;
    let suppliedHeaders: NullableHeaders | undefined;
    let refreshSuppliedHeaders: ((afterAuthentication?: boolean) => NullableHeaders) | undefined;
    const preferredHeaders: { source: HeadersLike; snapshot: NullableHeaders }[] = [];
    if (
      this._workloadIdentityAuth instanceof WorkloadIdentityAuth &&
      (this.#canPreflightWorkloadIdentityHeaders(options) || requestHeaderSnapshot)
    ) {
      const canPreflight = this.#canPreflightWorkloadIdentityHeaders(options);
      // Custom hooks keep first access to defaults; body encoding only needs request headers early.
      let defaultLayer = this.#workloadTokenProvenance.scopeFor(options, credentialContext)?.headers
        ?.defaultHeaders;
      const bodyLayer = snapshotHeaders(bodyHeaders);
      const requestLayer = requestHeaderSnapshot ?? snapshotHeaders(options.headers);
      let initialized = false;
      refreshSuppliedHeaders = (afterAuthentication = false) => {
        const existingDefaultLayer = defaultLayer;
        const refreshDefault = (initialized || afterAuthentication) && existingDefaultLayer?.initialized;
        defaultLayer ??= snapshotHeaders(this._options.defaultHeaders);
        if (
          !defaultLayer.initialized &&
          !requestLayer.initialized &&
          defaultLayer.source === requestLayer.source &&
          (defaultLayer.source === this._options.defaultHeaders || requestLayer.source === options.headers)
        ) {
          requestLayer.seed(requestLayer.source, defaultLayer.snapshot);
        }
        const result = buildHeaders([
          refreshDefault || defaultLayer.source !== this._options.defaultHeaders
            ? defaultLayer.refresh(this._options.defaultHeaders)
            : defaultLayer.snapshot,
          bodyLayer.snapshot,
          initialized || !canPreflight || requestLayer.source !== options.headers
            ? requestLayer.refresh(options.headers)
            : requestLayer.snapshot,
        ]);
        initialized = true;
        const scope = this.#workloadTokenProvenance.scopeFor(options, credentialContext);
        if (scope?.headers) scope.captureHeaders(scope.headers);
        return result;
      };
      if (canPreflight) {
        suppliedHeaders = refreshSuppliedHeaders();
        if (suppliesWorkloadAuthorization(suppliedHeaders)) {
          authenticationSecurity = { ...security, bearerAuth: false };
        }
      }
      if (defaultLayer?.initialized && !defaultLayer.replayable) {
        preferredHeaders.push({ source: defaultLayer.source, snapshot: defaultLayer.snapshot });
      }
      if (requestLayer.initialized && !requestLayer.replayable) {
        preferredHeaders.push({ source: requestLayer.source, snapshot: requestLayer.snapshot });
      }
    }
    const authentication = captureHeaderReads(
      () =>
        this._provider || this.#x509Authentication?.isPlanningRequest()
          ? undefined
          : this.#workloadTokenProvenance.invoke(options, credentialContext, () =>
              this.authHeaders(options, authenticationSecurity, credentialContext),
            ),
      preferredHeaders,
      (source, snapshot) => {
        const scope = this.#workloadTokenProvenance.scopeFor(options, credentialContext);
        if (!scope?.headers) return;
        for (const layer of [scope.headers.defaultHeaders, scope.headers.requestHeaders]) {
          layer.seed(source, snapshot);
        }
        // A canonical hook read can consume a deferred source before the hook enters a nested build.
        scope.captureHeaders(scope.headers);
      },
    );
    let authenticationHeaders = await authentication.result;
    if (refreshSuppliedHeaders) {
      const defaultHeaderSnapshot = this.#workloadTokenProvenance.scopeFor(options, credentialContext)
        ?.headers?.defaultHeaders;
      if (defaultHeaderSnapshot && !defaultHeaderSnapshot.initialized) {
        const captured =
          typeof this._options.defaultHeaders === 'object' && this._options.defaultHeaders !== null
            ? authentication.captured.get(this._options.defaultHeaders)
            : undefined;
        defaultHeaderSnapshot.seed(this._options.defaultHeaders, captured);
      }
      if (requestHeaderSnapshot && !requestHeaderSnapshot.initialized) {
        const captured =
          typeof options.headers === 'object' && options.headers !== null
            ? authentication.captured.get(options.headers)
            : undefined;
        requestHeaderSnapshot.seed(options.headers, captured);
      }
      suppliedHeaders = refreshSuppliedHeaders(true);
      if (
        !this._provider &&
        authenticationSecurity !== security &&
        !suppliesWorkloadAuthorization(suppliedHeaders)
      ) {
        // A caller may remove its override while the skipped authentication promise yields.
        authenticationHeaders = await this.#workloadTokenProvenance.invoke(options, credentialContext, () =>
          this.authHeaders(options, security, credentialContext),
        );
        suppliedHeaders = refreshSuppliedHeaders();
      }
    }
    authenticationHeaders = this.#workloadTokenProvenance.recover(
      authenticationHeaders,
      options,
      credentialContext,
    );
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: 'application/json',
        ...(!isRunningInBrowserOrBrowserWorker() ? { 'User-Agent': this.getUserAgent() } : undefined),
        'X-Stainless-Retry-Count': String(retryCount),
        ...(timeout ? { 'X-Stainless-Timeout': String(Math.trunc(timeout / 1000)) } : {}),
        ...getPlatformHeaders(),
        ...(typeof helperMethod === 'string' ? { 'X-Stainless-Helper-Method': helperMethod } : {}),
        'OpenAI-Organization': x509Tenant ? x509Tenant.organization : this.organization,
        'OpenAI-Project': x509Tenant ? x509Tenant.project : this.project,
      },
      authenticationHeaders,
      suppliedHeaders ?? x509Headers?.defaultHeaders ?? this._options.defaultHeaders,
      suppliedHeaders ? undefined : bodyHeaders,
      suppliedHeaders ? undefined : (x509Headers?.requestHeaders ?? options.headers),
    ]);

    if (!this._provider && !this.#x509Authentication?.isPlanningRequest()) {
      this.validateHeaders(headers, security);
    }

    return headers.values;
  }

  #workloadIdentityRequest(
    controller: AbortController,
    init: RequestInit | undefined,
    context: object | undefined,
  ) {
    const lookup = (key: object) => {
      const requests = this.#workloadIdentityRequests.get(key);
      return requests?.size === 1 ? requests.values().next().value : undefined;
    };
    if (context !== undefined) return lookup(context);
    const carrier = init && this.#workloadTokenProvenance.requestCarrier(init);
    return (init && lookup(init)) ?? (carrier && lookup(carrier)) ?? lookup(controller);
  }

  #bindWorkloadIdentityRequest(key: object, request: WorkloadIdentityRequest) {
    const requests = this.#workloadIdentityRequests.get(key) ?? new Set<WorkloadIdentityRequest>();
    requests.add(request);
    this.#workloadIdentityRequests.set(key, requests);
    request.bindings.add(key);
  }

  #snapshotWorkloadIdentityUsage<T extends RequestInit>(
    request: WorkloadIdentityRequest | undefined,
    url: RequestInfo,
    init: T,
  ): { init: T; used: boolean } {
    if (!request || request.authorization === undefined) return { init, used: false };
    const requestHeaders = init.headers === undefined ? getRequestHeaders(url) : undefined;
    const sourceHeaders = init.headers ?? requestHeaders;
    const platformHeader =
      sourceHeaders && hasNativeHeadersBrand(sourceHeaders)
        ? getPlatformHeader(sourceHeaders, 'Authorization')
        : undefined;
    const preserveHeaders =
      sourceHeaders === undefined ||
      platformHeader !== undefined ||
      (init.headers !== undefined && canPreserveHeaderInput(init.headers));
    const headers = platformHeader ? undefined : new Headers(sourceHeaders);
    // Record what the SDK hands to fetch before asynchronous transport callbacks can mutate it.
    const used =
      (request.credential?.isCurrent() ?? false) &&
      this.#workloadTokenProvenance.matchesHeaderCredential(sourceHeaders, request.authorization) !== false &&
      bearerToken(platformHeader ? platformHeader.value : (headers?.get('Authorization') ?? null)) ===
        bearerToken(request.authorization);
    return { init: preserveHeaders ? init : ({ ...init, headers } as T), used };
  }

  #observeWorkloadHeaderReplacement(
    credential: WorkloadCredentialUsage | undefined,
    request: RequestInit,
    authorization: string | undefined,
  ): void {
    if (!credential || authorization === undefined || request.headers === undefined) {
      return;
    }
    if (this.#workloadTokenProvenance.matchesHeaderCredential(request.headers, authorization) === false) {
      credential.revoke();
      return;
    }
    if (!credential.isCurrent()) return;
    if (!canPreserveHeaderInput(request.headers)) {
      request.headers = new Headers(request.headers);
    }
    const headers = request.headers;
    const native = hasNativeHeadersBrand(headers);
    const platformHeader = native ? getPlatformHeader(headers, 'Authorization') : undefined;
    const value = platformHeader ? platformHeader.value : new Headers(headers).get('Authorization');
    if (
      this.#workloadTokenProvenance.matchesHeaderCredential(headers, authorization) === false ||
      bearerToken(value) !== bearerToken(authorization)
    ) {
      credential.revoke();
    } else if (native) {
      credential.adopt(headers as Headers);
    }
  }

  private _makeAbort(controller: AbortController) {
    // note: we can't just inline this method inside `fetchWithTimeout()` because then the closure
    //       would capture all request options, and cause a memory leak.
    return () => controller.abort();
  }

  private _makeUserAbortError(signal: NonNullable<RequestInit['signal']>): Errors.APIUserAbortError {
    const error = new Errors.APIUserAbortError();
    Object.defineProperty(error, 'cause', { value: signal.reason, writable: true, configurable: true });
    return error;
  }

  private buildBody({ options }: { options: FinalRequestOptions }): {
    bodyHeaders: HeadersLike;
    body: BodyInit | undefined;
    isStreamingBody: boolean;
  } {
    const { body, headers: rawHeaders } = options;
    if (!body) {
      // A resource method always passes a `body` key when its operation defines a
      // request body, even if the caller omitted an optional body param. Keep the
      // content-type for those, and only elide it for operations with no body at
      // all (e.g. GET/DELETE).
      if (body === undefined && 'body' in options) {
        return { ...this.#encoder({ body, headers: buildHeaders([rawHeaders]) }), isStreamingBody: false };
      }
      return { bodyHeaders: undefined, body: undefined, isStreamingBody: false };
    }
    const headers = buildHeaders([rawHeaders]);

    const isReadableStream =
      typeof (globalThis as any).ReadableStream !== 'undefined' &&
      body instanceof (globalThis as any).ReadableStream;

    const isRetryableBody =
      !isReadableStream &&
      (typeof body === 'string' ||
        body instanceof ArrayBuffer ||
        ArrayBuffer.isView(body) ||
        (typeof (globalThis as any).Blob !== 'undefined' && body instanceof (globalThis as any).Blob) ||
        body instanceof URLSearchParams ||
        body instanceof FormData);

    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) ||
      body instanceof ArrayBuffer ||
      body instanceof DataView ||
      (typeof body === 'string' &&
        // Preserve legacy string encoding behavior for now
        headers.values.has('content-type')) ||
      // `Blob` is superset of `File`
      ((globalThis as any).Blob && body instanceof (globalThis as any).Blob) ||
      // `FormData` -> `multipart/form-data`
      body instanceof FormData ||
      // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams ||
      // Send chunked stream (each chunk has own `length`)
      isReadableStream
    ) {
      return { bodyHeaders: undefined, body: body as BodyInit, isStreamingBody: !isRetryableBody };
    } else if (
      typeof body === 'object' &&
      (Symbol.asyncIterator in body ||
        (Symbol.iterator in body && 'next' in body && typeof body.next === 'function'))
    ) {
      return {
        bodyHeaders: undefined,
        body: Shims.ReadableStreamFrom(body as AsyncIterable<Uint8Array>),
        isStreamingBody: true,
      };
    } else if (
      typeof body === 'object' &&
      headers.values.get('content-type') === 'application/x-www-form-urlencoded'
    ) {
      return {
        bodyHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
        body: this.stringifyQuery(body),
        isStreamingBody: false,
      };
    } else {
      return { ...this.#encoder({ body, headers }), isStreamingBody: false };
    }
  }

  static OpenAI = this;
  static DEFAULT_TIMEOUT = 600000; // 10 minutes

  static OpenAIError = Errors.OpenAIError;
  static APIError = Errors.APIError;
  static APIConnectionError = Errors.APIConnectionError;
  static APIConnectionTimeoutError = Errors.APIConnectionTimeoutError;
  static APIUserAbortError = Errors.APIUserAbortError;
  static NotFoundError = Errors.NotFoundError;
  static ConflictError = Errors.ConflictError;
  static RateLimitError = Errors.RateLimitError;
  static BadRequestError = Errors.BadRequestError;
  static AuthenticationError = Errors.AuthenticationError;
  static InternalServerError = Errors.InternalServerError;
  static PermissionDeniedError = Errors.PermissionDeniedError;
  static UnprocessableEntityError = Errors.UnprocessableEntityError;
  static InvalidWebhookSignatureError = Errors.InvalidWebhookSignatureError;

  static toFile = Uploads.toFile;
  static toStreamingFile = Uploads.toStreamingFile;

  /**
   * Given a prompt, the model will return one or more predicted completions, and can also return the probabilities of alternative tokens at each position.
   */
  completions: API.Completions = new API.Completions(this);
  chat: API.Chat = new API.Chat(this);
  /**
   * Get a vector representation of a given input that can be easily consumed by machine learning models and algorithms.
   */
  embeddings: API.Embeddings = new API.Embeddings(this);
  /**
   * Files are used to upload documents that can be used with features like Assistants and Fine-tuning.
   */
  files: API.Files = new API.Files(this);
  /**
   * Given a prompt and/or an input image, the model will generate a new image.
   */
  images: API.Images = new API.Images(this);
  contentProvenanceChecks: API.ContentProvenanceChecks = new API.ContentProvenanceChecks(this);
  audio: API.Audio = new API.Audio(this);
  /**
   * Given text and/or image inputs, classifies if those inputs are potentially harmful.
   */
  moderations: API.Moderations = new API.Moderations(this);
  /**
   * List and describe the various models available in the API.
   */
  models: API.Models = new API.Models(this);
  fineTuning: API.FineTuning = new API.FineTuning(this);
  graders: API.Graders = new API.Graders(this);
  vectorStores: API.VectorStores = new API.VectorStores(this);
  safety: API.Safety = new API.Safety(this);
  webhooks: API.Webhooks = new API.Webhooks(this);
  beta: API.Beta = new API.Beta(this);
  /**
   * Create large batches of API requests to run asynchronously.
   */
  batches: API.Batches = new API.Batches(this);
  /**
   * Use Uploads to upload large files in multiple parts.
   */
  uploads: API.Uploads = new API.Uploads(this);
  admin: API.Admin = new API.Admin(this);
  responses: API.Responses = new API.Responses(this);
  realtime: API.Realtime = new API.Realtime(this);
  /**
   * Manage conversations and conversation items.
   */
  conversations: API.Conversations = new API.Conversations(this);
  /**
   * Manage and run evals in the OpenAI platform.
   */
  evals: API.Evals = new API.Evals(this);
  containers: API.Containers = new API.Containers(this);
  skills: API.Skills = new API.Skills(this);
  /**
   * @deprecated The Sora API is scheduled to permanently shut down on September 24, 2026.
   */
  videos: API.Videos = new API.Videos(this);
}

OpenAI.Completions = Completions;
OpenAI.Chat = Chat;
OpenAI.Embeddings = Embeddings;
OpenAI.Files = Files;
OpenAI.Images = Images;
OpenAI.ContentProvenanceChecks = ContentProvenanceChecks;
OpenAI.Audio = Audio;
OpenAI.Moderations = Moderations;
OpenAI.Models = Models;
OpenAI.FineTuning = FineTuning;
OpenAI.Graders = Graders;
OpenAI.VectorStores = VectorStores;
OpenAI.Safety = Safety;
OpenAI.Webhooks = Webhooks;
OpenAI.Beta = Beta;
OpenAI.Batches = Batches;
OpenAI.Uploads = UploadsAPIUploads;
OpenAI.Admin = Admin;
OpenAI.Responses = Responses;
OpenAI.Realtime = Realtime;
OpenAI.Conversations = Conversations;
OpenAI.Evals = Evals;
OpenAI.Containers = Containers;
OpenAI.Skills = Skills;
OpenAI.Videos = Videos;

const composedCallerSignals = new WeakMap<AbortController, AbortSignal>();

function createRequestController(
  callerSignal: AbortSignal | null | undefined,
  originalSignal?: AbortSignal | null,
): AbortController {
  const controller = new AbortController();
  if (!callerSignal) return controller;

  const nativeAbortSignal = (globalThis as any).AbortSignal;
  if (typeof nativeAbortSignal?.any !== 'function' || !(callerSignal instanceof nativeAbortSignal)) {
    return controller;
  }

  try {
    // Native composition keeps cancellation active after response headers without
    // retaining an abort listener on the caller's signal or changing its reason.
    const signals = [controller.signal, callerSignal];
    if (originalSignal && originalSignal !== callerSignal) {
      signals.push(originalSignal);
    }
    const composed = nativeAbortSignal.any(signals) as AbortSignal;
    Object.defineProperty(controller, 'signal', { value: composed, configurable: true });
    composedCallerSignals.set(controller, callerSignal);
  } catch {
    // Older or incompatible runtimes retain the existing listener-based fallback.
  }

  return controller;
}

function getConnectionErrorMessage(error: Error): string | undefined {
  if (isUndiciDispatcherVersionMismatchError(error)) {
    return `Connection error. This may be caused by passing an undici dispatcher, such as ProxyAgent, that is incompatible with the fetch implementation. If you are using undici's ProxyAgent, pass the fetch implementation from the same undici package: import { fetch, ProxyAgent } from 'undici'; new OpenAI({ fetch, fetchOptions: { dispatcher: new ProxyAgent(...) } });`;
  }

  return undefined;
}

type ErrorLikeWithCause = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

function isUndiciDispatcherVersionMismatchError(error: unknown): boolean {
  let current = error;

  for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
    const err = current as ErrorLikeWithCause;
    if (
      err.code === 'UND_ERR_INVALID_ARG' &&
      typeof err.message === 'string' &&
      err.message.includes('invalid onRequestStart method')
    ) {
      return true;
    }

    current = err.cause;
  }

  return false;
}

export declare namespace OpenAI {
  export { type DataResidency as DataResidency };
  export type RequestOptions = Opts.RequestOptions;

  export import Page = Pagination.Page;
  export { type PageResponse as PageResponse };

  export import CursorPage = Pagination.CursorPage;
  export { type CursorPageParams as CursorPageParams, type CursorPageResponse as CursorPageResponse };

  export import ConversationCursorPage = Pagination.ConversationCursorPage;
  export {
    type ConversationCursorPageParams as ConversationCursorPageParams,
    type ConversationCursorPageResponse as ConversationCursorPageResponse,
  };

  export import NextCursorPage = Pagination.NextCursorPage;
  export {
    type NextCursorPageParams as NextCursorPageParams,
    type NextCursorPageResponse as NextCursorPageResponse,
  };

  export {
    Completions as Completions,
    type Completion as Completion,
    type CompletionChoice as CompletionChoice,
    type CompletionUsage as CompletionUsage,
    type CompletionCreateParams as CompletionCreateParams,
    type CompletionCreateParamsNonStreaming as CompletionCreateParamsNonStreaming,
    type CompletionCreateParamsStreaming as CompletionCreateParamsStreaming,
  };

  export {
    Chat as Chat,
    type ChatCompletion as ChatCompletion,
    type ChatCompletionAllowedToolChoice as ChatCompletionAllowedToolChoice,
    type ChatCompletionAssistantMessageParam as ChatCompletionAssistantMessageParam,
    type ChatCompletionAudio as ChatCompletionAudio,
    type ChatCompletionAudioParam as ChatCompletionAudioParam,
    type ChatCompletionChunk as ChatCompletionChunk,
    type ChatCompletionContentPart as ChatCompletionContentPart,
    type ChatCompletionContentPartImage as ChatCompletionContentPartImage,
    type ChatCompletionContentPartInputAudio as ChatCompletionContentPartInputAudio,
    type ChatCompletionContentPartRefusal as ChatCompletionContentPartRefusal,
    type ChatCompletionContentPartText as ChatCompletionContentPartText,
    type ChatCompletionCustomTool as ChatCompletionCustomTool,
    type ChatCompletionDeleted as ChatCompletionDeleted,
    type ChatCompletionDeveloperMessageParam as ChatCompletionDeveloperMessageParam,
    type ChatCompletionFunctionCallOption as ChatCompletionFunctionCallOption,
    type ChatCompletionFunctionMessageParam as ChatCompletionFunctionMessageParam,
    type ChatCompletionFunctionTool as ChatCompletionFunctionTool,
    type ChatCompletionMessage as ChatCompletionMessage,
    type ChatCompletionMessageCustomToolCall as ChatCompletionMessageCustomToolCall,
    type ChatCompletionMessageFunctionToolCall as ChatCompletionMessageFunctionToolCall,
    type ChatCompletionMessageParam as ChatCompletionMessageParam,
    type ChatCompletionMessageToolCall as ChatCompletionMessageToolCall,
    type ChatCompletionModality as ChatCompletionModality,
    type ChatCompletionNamedToolChoice as ChatCompletionNamedToolChoice,
    type ChatCompletionNamedToolChoiceCustom as ChatCompletionNamedToolChoiceCustom,
    type ChatCompletionPredictionContent as ChatCompletionPredictionContent,
    type ChatCompletionRole as ChatCompletionRole,
    type ChatCompletionStoreMessage as ChatCompletionStoreMessage,
    type ChatCompletionStreamOptions as ChatCompletionStreamOptions,
    type ChatCompletionSystemMessageParam as ChatCompletionSystemMessageParam,
    type ChatCompletionTokenLogprob as ChatCompletionTokenLogprob,
    type ChatCompletionTool as ChatCompletionTool,
    type ChatCompletionToolChoiceOption as ChatCompletionToolChoiceOption,
    type ChatCompletionToolMessageParam as ChatCompletionToolMessageParam,
    type ChatCompletionUserMessageParam as ChatCompletionUserMessageParam,
    type ChatCompletionAllowedTools as ChatCompletionAllowedTools,
    type ChatCompletionReasoningEffort as ChatCompletionReasoningEffort,
    type ChatCompletionsPage as ChatCompletionsPage,
    type ChatCompletionCreateParams as ChatCompletionCreateParams,
    type ChatCompletionCreateParamsNonStreaming as ChatCompletionCreateParamsNonStreaming,
    type ChatCompletionCreateParamsStreaming as ChatCompletionCreateParamsStreaming,
    type ChatCompletionUpdateParams as ChatCompletionUpdateParams,
    type ChatCompletionListParams as ChatCompletionListParams,
  };

  export {
    Embeddings as Embeddings,
    type CreateEmbeddingResponse as CreateEmbeddingResponse,
    type Embedding as Embedding,
    type EmbeddingModel as EmbeddingModel,
    type EmbeddingCreateParams as EmbeddingCreateParams,
  };

  export {
    Files as Files,
    type FileContent as FileContent,
    type FileDeleted as FileDeleted,
    type FileObject as FileObject,
    type FilePurpose as FilePurpose,
    type FileObjectsPage as FileObjectsPage,
    type FileCreateParams as FileCreateParams,
    type FileListParams as FileListParams,
  };

  export {
    Images as Images,
    type Image as Image,
    type ImageEditCompletedEvent as ImageEditCompletedEvent,
    type ImageEditPartialImageEvent as ImageEditPartialImageEvent,
    type ImageEditStreamEvent as ImageEditStreamEvent,
    type ImageGenCompletedEvent as ImageGenCompletedEvent,
    type ImageGenPartialImageEvent as ImageGenPartialImageEvent,
    type ImageGenStreamEvent as ImageGenStreamEvent,
    type ImageModel as ImageModel,
    type ImagesResponse as ImagesResponse,
    type ImageCreateVariationParams as ImageCreateVariationParams,
    type ImageEditParams as ImageEditParams,
    type ImageEditParamsNonStreaming as ImageEditParamsNonStreaming,
    type ImageEditParamsStreaming as ImageEditParamsStreaming,
    type ImageGenerateParams as ImageGenerateParams,
    type ImageGenerateParamsNonStreaming as ImageGenerateParamsNonStreaming,
    type ImageGenerateParamsStreaming as ImageGenerateParamsStreaming,
  };

  export {
    ContentProvenanceChecks as ContentProvenanceChecks,
    type ContentProvenanceCheck as ContentProvenanceCheck,
    type ContentProvenanceCheckCreateParams as ContentProvenanceCheckCreateParams,
  };

  export { Audio as Audio, type AudioModel as AudioModel, type AudioResponseFormat as AudioResponseFormat };

  export {
    Moderations as Moderations,
    type Moderation as Moderation,
    type ModerationImageURLInput as ModerationImageURLInput,
    type ModerationModel as ModerationModel,
    type ModerationMultiModalInput as ModerationMultiModalInput,
    type ModerationTextInput as ModerationTextInput,
    type ModerationCreateResponse as ModerationCreateResponse,
    type ModerationCreateParams as ModerationCreateParams,
  };

  export {
    Models as Models,
    type Model as Model,
    type ModelDeleted as ModelDeleted,
    type ModelsPage as ModelsPage,
  };

  export { FineTuning as FineTuning };

  export { Graders as Graders };

  export {
    VectorStores as VectorStores,
    type AutoFileChunkingStrategyParam as AutoFileChunkingStrategyParam,
    type FileChunkingStrategy as FileChunkingStrategy,
    type FileChunkingStrategyParam as FileChunkingStrategyParam,
    type OtherFileChunkingStrategyObject as OtherFileChunkingStrategyObject,
    type StaticFileChunkingStrategy as StaticFileChunkingStrategy,
    type StaticFileChunkingStrategyObject as StaticFileChunkingStrategyObject,
    type StaticFileChunkingStrategyObjectParam as StaticFileChunkingStrategyObjectParam,
    type VectorStore as VectorStore,
    type VectorStoreDeleted as VectorStoreDeleted,
    type VectorStoreSearchResponse as VectorStoreSearchResponse,
    type VectorStoresPage as VectorStoresPage,
    type VectorStoreSearchResponsesPage as VectorStoreSearchResponsesPage,
    type VectorStoreCreateParams as VectorStoreCreateParams,
    type VectorStoreUpdateParams as VectorStoreUpdateParams,
    type VectorStoreListParams as VectorStoreListParams,
    type VectorStoreSearchParams as VectorStoreSearchParams,
  };

  export { Safety as Safety };

  export { Webhooks as Webhooks };

  export { Beta as Beta };

  export {
    Batches as Batches,
    type Batch as Batch,
    type BatchError as BatchError,
    type BatchRequestCounts as BatchRequestCounts,
    type BatchUsage as BatchUsage,
    type BatchesPage as BatchesPage,
    type BatchCreateParams as BatchCreateParams,
    type BatchListParams as BatchListParams,
  };

  export {
    UploadsAPIUploads as Uploads,
    type Upload as Upload,
    type UploadCreateParams as UploadCreateParams,
    type UploadCompleteParams as UploadCompleteParams,
  };

  export { Admin as Admin };

  export { Responses as Responses };

  export { Realtime as Realtime };

  export { Conversations as Conversations };

  export {
    Evals as Evals,
    type EvalCustomDataSourceConfig as EvalCustomDataSourceConfig,
    type EvalStoredCompletionsDataSourceConfig as EvalStoredCompletionsDataSourceConfig,
    type EvalCreateResponse as EvalCreateResponse,
    type EvalRetrieveResponse as EvalRetrieveResponse,
    type EvalUpdateResponse as EvalUpdateResponse,
    type EvalListResponse as EvalListResponse,
    type EvalDeleteResponse as EvalDeleteResponse,
    type EvalListResponsesPage as EvalListResponsesPage,
    type EvalCreateParams as EvalCreateParams,
    type EvalUpdateParams as EvalUpdateParams,
    type EvalListParams as EvalListParams,
  };

  export {
    Containers as Containers,
    type ContainerCreateResponse as ContainerCreateResponse,
    type ContainerRetrieveResponse as ContainerRetrieveResponse,
    type ContainerListResponse as ContainerListResponse,
    type ContainerListResponsesPage as ContainerListResponsesPage,
    type ContainerCreateParams as ContainerCreateParams,
    type ContainerListParams as ContainerListParams,
  };

  export {
    Skills as Skills,
    type DeletedSkill as DeletedSkill,
    type Skill as Skill,
    type SkillList as SkillList,
    type SkillsPage as SkillsPage,
    type SkillCreateParams as SkillCreateParams,
    type SkillUpdateParams as SkillUpdateParams,
    type SkillListParams as SkillListParams,
  };

  export {
    Videos as Videos,
    type ImageInputReferenceParam as ImageInputReferenceParam,
    type Video as Video,
    type VideoCreateError as VideoCreateError,
    type VideoModel as VideoModel,
    type VideoSeconds as VideoSeconds,
    type VideoSize as VideoSize,
    type VideoDeleteResponse as VideoDeleteResponse,
    type VideoCreateCharacterResponse as VideoCreateCharacterResponse,
    type VideoGetCharacterResponse as VideoGetCharacterResponse,
    type VideosPage as VideosPage,
    type VideoCreateParams as VideoCreateParams,
    type VideoListParams as VideoListParams,
    type VideoCreateCharacterParams as VideoCreateCharacterParams,
    type VideoDownloadContentParams as VideoDownloadContentParams,
    type VideoEditParams as VideoEditParams,
    type VideoExtendParams as VideoExtendParams,
    type VideoRemixParams as VideoRemixParams,
  };

  export type AllModels = API.AllModels;
  export type ChatModel = API.ChatModel;
  export type ComparisonFilter = API.ComparisonFilter;
  export type CompoundFilter = API.CompoundFilter;
  export type CustomToolInputFormat = API.CustomToolInputFormat;
  export type ErrorObject = API.ErrorObject;
  export type FunctionDefinition = API.FunctionDefinition;
  export type FunctionParameters = API.FunctionParameters;
  export type Metadata = API.Metadata;
  export type OAuthErrorCode = API.OAuthErrorCode;
  export type Reasoning = API.Reasoning;
  export type ReasoningEffort = API.ReasoningEffort;
  export type ResponseFormatJSONObject = API.ResponseFormatJSONObject;
  export type ResponseFormatJSONSchema = API.ResponseFormatJSONSchema;
  export type ResponseFormatText = API.ResponseFormatText;
  export type ResponseFormatTextGrammar = API.ResponseFormatTextGrammar;
  export type ResponseFormatTextPython = API.ResponseFormatTextPython;
  export type ResponsesModel = API.ResponsesModel;
}
