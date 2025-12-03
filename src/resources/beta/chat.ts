import { APIResource } from '../../resource';
import {
  BetaToolRunner,
  type BetaToolRunnerParams,
  type BetaToolRunnerRequestOptions,
} from '../../lib/beta/BetaToolRunner';

export class BetaCompletions extends APIResource {
  toolRunner(
    body: BetaToolRunnerParams & { stream?: false },
    options?: BetaToolRunnerRequestOptions,
  ): BetaToolRunner<false>;
  toolRunner(
    body: BetaToolRunnerParams & { stream: true },
    options?: BetaToolRunnerRequestOptions,
  ): BetaToolRunner<true>;
  toolRunner(body: BetaToolRunnerParams, options?: BetaToolRunnerRequestOptions): BetaToolRunner<boolean>;
  toolRunner(body: BetaToolRunnerParams, options?: BetaToolRunnerRequestOptions): BetaToolRunner<boolean> {
    return new BetaToolRunner(this._client, body, options);
  }
}

export class BetaChat extends APIResource {
  completions: BetaCompletions = new BetaCompletions(this._client);
}
